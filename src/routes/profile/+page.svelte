
<script>
    import { jsPDF } from "jspdf";
    import autoTable from "jspdf-autotable";
    import { goto } from '$app/navigation';

    let chamber = $state("senate");
    let districtNumber = $state("1");

    let isLoading = $state(false);
    let isGeneratingPDF = $state(false);
    let error = $state("");
    let profile = $state(null);

    let districtData = $state(null);
    let datasetMetadata = $state(null);

    const OLLAMA_URL = "http://localhost:11434/api/chat";
    const MODEL = "qwen3:8b";

    let districtCount = $derived(
        chamber === "senate" ? 25 : 51
    );

    let chamberName = $derived(
        chamber === "senate" ? "Senate" : "House"
    );

    let districtLabel = $derived(
        `${chamberName} District ${districtNumber}`
    );

    function formatValue(value) {
        if (value === null || value === undefined) {
            return "Not available";
        }

        if (typeof value === "number") {
            return value.toLocaleString("en-US");
        }

        return String(value);
    }

    function formatPercent(value) {
        if (value === null || value === undefined) {
            return "—";
        }

        if (typeof value === "number") {
            return `${value}%`;
        }

        return String(value);
    }

    // Load the selected district and its dataset metadata.
    async function loadDistrict() {
        const path = `/data/${chamber}.json`;

        const response = await fetch(path);

        if (!response.ok) {
            throw new Error(`Could not load ${path}`);
        }

        const json = await response.json();

        if (!json[districtNumber]) {
            throw new Error(
                `District ${districtNumber} was not found in ${path}`
            );
        }

        if (!json.metadata) {
            throw new Error(
                "The dataset does not contain metadata."
            );
        }

        districtData = json[districtNumber];
        datasetMetadata = json.metadata;
    }

    // Extract original statistics directly from the dataset.
    // This prevents Qwen from becoming the source of numerical data.
    function extractStatistics(data, parent = "") {
        const results = [];

        if (!data || typeof data !== "object") {
            return results;
        }

        for (const [key, value] of Object.entries(data)) {
            const label = parent
                ? `${parent} / ${key}`
                : key;

            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value) &&
                (
                    Object.hasOwn(value, "estimate") ||
                    Object.hasOwn(value, "percent")
                )
            ) {
                results.push({
                    label,
                    estimate: value.estimate,
                    marginOfError: value.margin_of_error,
                    percent: value.percent,
                    percentMarginOfError:
                        value.percent_margin_of_error
                });

                continue;
            }

            if (
                value &&
                typeof value === "object" &&
                !Array.isArray(value)
            ) {
                results.push(
                    ...extractStatistics(value, label)
                );
            }
        }

        return results;
    }

    function buildPrompt() {
        return `
You are a government research assistant preparing a district profile
for residents of Hawaii.

DISTRICT:
${districtLabel}

CHAMBER:
${chamberName}

DISTRICT DATA:
${JSON.stringify(districtData, null, 2)}

DATASET METADATA:
${JSON.stringify(datasetMetadata, null, 2)}

YOUR TASK:

Generate an informative, neutral, easy-to-understand profile
of this legislative district.

Use only the information supplied above.

IMPORTANT RULES:

1. Never invent statistics, facts, sources, or dates.
2. Do not use outside knowledge to fill gaps in the dataset.
3. Do not assume that a statistic is current simply because
   the dataset was recently updated.
4. Explain statistics in language ordinary residents can understand.
5. Distinguish actual measurements from interpretations.
6. Do not claim that one statistic causes another.
7. Do not make political endorsements or express political bias.
8. Do not make assumptions about individual residents based
   on district-wide statistics.
9. If information is missing, say so.
10. Do not invent source URLs.
11. Do not make legal, financial, or eligibility guarantees.
12. Do not describe a district characteristic unless it is
    supported by the supplied data.

GENERATE THESE SECTIONS:

- District Overview
- Population and Demographics
- Income and Economic Conditions
- Housing and Households
- Education and Employment
- Notable Findings
- Data Limitations

For each section, explain what the available data tells us.
If a category is not represented in the data, acknowledge that.

For Notable Findings, identify meaningful patterns supported
by the supplied statistics. Do not exaggerate their significance.

RETURN ONLY VALID JSON:

{
    "title": "District Profile",
    "subtitle": "",
    "overview": "",
    "sections": [
        {
            "heading": "",
            "content": ""
        }
    ],
    "notable_findings": [
        ""
    ],
    "limitations": [
        ""
    ]
}
`;
    }

    function parseProfile(content) {
        // Remove Qwen thinking tags if they appear.
        content = content.replace(
            /<think>[\s\S]*?<\/think>/gi,
            ""
        ).trim();

        // Remove Markdown code fences if present.
        content = content
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/, "")
            .trim();

        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");

        if (start === -1 || end === -1) {
            throw new Error(
                "Qwen did not return valid JSON. Try generating again."
            );
        }

        const parsed = JSON.parse(
            content.slice(start, end + 1)
        );

        if (
            !parsed.overview ||
            !Array.isArray(parsed.sections)
        ) {
            throw new Error(
                "The generated profile is missing required sections."
            );
        }

        return parsed;
    }

    // Ask Qwen to generate the profile.
    async function generateProfile() {
        isLoading = true;
        error = "";
        profile = null;

        try {
            await loadDistrict();

            const response = await fetch(OLLAMA_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: MODEL,
                    messages: [
                        {
                            role: "user",
                            content: buildPrompt()
                        }
                    ],
                    stream: false,
                    think: false,
                    format: "json",
                    options: {
                        temperature: 0.2
                    }
                })
            });

            if (!response.ok) {
                throw new Error(
                    `Ollama returned an error: ${response.status}`
                );
            }

            const result = await response.json();

            const content = result.message?.content;

            if (!content) {
                throw new Error(
                    "Qwen returned an empty response."
                );
            }

            profile = parseProfile(content);

        } catch (err) {
            console.error(err);

            error = err.message ||
                "Something went wrong generating the profile.";

        } finally {
            isLoading = false;
        }
    }

    // Helpers for creating PDF content.
    function addParagraph(doc, text, y, options = {}) {
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const margin = 18;
        const fontSize = options.fontSize || 10;

        doc.setFontSize(fontSize);
        doc.setFont(
            "helvetica",
            options.bold ? "bold" : "normal"
        );

        const lines = doc.splitTextToSize(
            String(text || ""),
            pageWidth - margin * 2
        );

        const lineHeight = fontSize * 0.5;
        const height = lines.length * lineHeight + 3;

        if (y + height > pageHeight - 20) {
            doc.addPage();
            y = 20;
        }

        doc.text(lines, margin, y);

        return y + height;
    }

    function addHeading(doc, heading, y) {
        const pageHeight = doc.internal.pageSize.getHeight();

        if (y + 20 > pageHeight - 20) {
            doc.addPage();
            y = 20;
        }

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(heading, 18, y);

        return y + 9;
    }

    function addPageFooters(doc) {
        const pageCount = doc.internal.getNumberOfPages();

        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);

            const width = doc.internal.pageSize.getWidth();
            const height = doc.internal.pageSize.getHeight();

            doc.setFontSize(8);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(120);

            doc.text(
                "Know Your District | Hawaii",
                18,
                height - 10
            );

            doc.text(
                `Page ${i} of ${pageCount}`,
                width - 18,
                height - 10,
                { align: "right" }
            );
        }
    }

    function addDatasetSources(doc, metadata, y) {
        y = addHeading(
            doc,
            "Sources and Methodology",
            y
        );

        const fields = [
            ["Dataset", metadata.dataset_name],
            ["Source", metadata.source],
            ["Survey period", metadata.survey_period],
            ["Period", metadata.period],
            ["Year", metadata.year],
            ["Geography", metadata.geography],
            ["Geography vintage", metadata.geography_vintage],
            ["Methodology", metadata.methodology],
            ["Margin of error", metadata.margin_of_error]
        ];

        const rows = fields
            .filter(([label, value]) =>
                value !== undefined &&
                value !== null &&
                value !== ""
            )
            .map(([label, value]) => [
                label,
                typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)
            ]);

        if (rows.length > 0) {
            autoTable(doc, {
                startY: y,
                head: [["Metadata", "Information"]],
                body: rows,
                theme: "grid",
                styles: {
                    fontSize: 8,
                    cellPadding: 3,
                    overflow: "linebreak"
                },
                headStyles: {
                    fillColor: [35, 55, 85]
                },
                margin: {
                    left: 18,
                    right: 18
                }
            });

            y = doc.lastAutoTable.finalY + 8;
        }

        if (metadata.source_url) {
            y = addParagraph(
                doc,
                `Dataset source URL: ${metadata.source_url}`,
                y,
                { fontSize: 8 }
            );
        }

        if (metadata.limitations) {
            y = addParagraph(
                doc,
                `Dataset limitations: ${
                    typeof metadata.limitations === "object"
                        ? JSON.stringify(metadata.limitations)
                        : metadata.limitations
                }`,
                y,
                { fontSize: 8 }
            );
        }

        return y;
    }

    // Create and download the final PDF.
    function downloadPDF() {
        if (!profile || !districtData || !datasetMetadata) {
            error = "Generate a district profile first.";
            return;
        }

        isGeneratingPDF = true;
        error = "";

        try {
            const doc = new jsPDF({
                orientation: "portrait",
                unit: "mm",
                format: "a4"
            });

            const pageWidth = doc.internal.pageSize.getWidth();

            // Cover / title area.
            doc.setFillColor(35, 55, 85);
            doc.rect(0, 0, pageWidth, 48, "F");

            doc.setTextColor(255, 255, 255);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(20);

            doc.text(
                profile.title || "District Profile",
                18,
                21
            );

            doc.setFont("helvetica", "normal");
            doc.setFontSize(11);

            doc.text(
                profile.subtitle || districtLabel,
                18,
                31
            );

            doc.setFontSize(9);

            doc.text(
                `Generated ${new Date().toLocaleDateString()}`,
                18,
                40
            );

            // Main overview.
            let y = 61;

            y = addHeading(
                doc,
                "District Overview",
                y
            );

            y = addParagraph(
                doc,
                profile.overview,
                y
            );

            // AI-generated sections.
            for (const section of profile.sections || []) {
                y += 4;

                y = addHeading(
                    doc,
                    section.heading || "District Information",
                    y
                );

                y = addParagraph(
                    doc,
                    section.content || "No information available.",
                    y
                );
            }

            // Notable findings.
            if (
                profile.notable_findings &&
                profile.notable_findings.length > 0
            ) {
                y += 4;

                y = addHeading(
                    doc,
                    "Notable Findings",
                    y
                );

                for (const finding of profile.notable_findings) {
                    y = addParagraph(
                        doc,
                        `• ${finding}`,
                        y
                    );
                }
            }

            // Original statistics, extracted from JSON.
            const statistics = extractStatistics(
                districtData
            );

            if (statistics.length > 0) {
                doc.addPage();
                y = 20;

                y = addHeading(
                    doc,
                    "Original District Statistics",
                    y
                );

                y = addParagraph(
                    doc,
                    "The following figures are taken directly from the district dataset. They have not been generated by the AI model.",
                    y,
                    { fontSize: 9 }
                );

                autoTable(doc, {
                    startY: y + 3,
                    head: [[
                        "Statistic",
                        "Estimate",
                        "Margin of Error",
                        "Percent",
                        "Percent MOE"
                    ]],
                    body: statistics.map(stat => [
                        stat.label,
                        formatValue(stat.estimate),
                        formatValue(stat.marginOfError),
                        formatPercent(stat.percent),
                        formatValue(stat.percentMarginOfError)
                    ]),
                    theme: "striped",
                    styles: {
                        fontSize: 7,
                        cellPadding: 2,
                        overflow: "linebreak"
                    },
                    headStyles: {
                        fillColor: [35, 55, 85]
                    },
                    columnStyles: {
                        0: { cellWidth: 65 },
                        1: { cellWidth: 27 },
                        2: { cellWidth: 30 },
                        3: { cellWidth: 25 },
                        4: { cellWidth: 30 }
                    },
                    margin: {
                        left: 10,
                        right: 10
                    }
                });
            }

            // Data limitations.
            if (
                profile.limitations &&
                profile.limitations.length > 0
            ) {
                doc.addPage();
                y = 20;

                y = addHeading(
                    doc,
                    "Data Limitations",
                    y
                );

                for (const limitation of profile.limitations) {
                    y = addParagraph(
                        doc,
                        `• ${limitation}`,
                        y
                    );
                }
            }

            // Official dataset metadata.
            doc.addPage();
            y = 20;

            addDatasetSources(
                doc,
                datasetMetadata,
                y
            );

            // Disclaimer.
            const finalY =
                doc.lastAutoTable?.finalY || 35;

            addParagraph(
                doc,
                "AI disclosure: This report contains AI-generated explanations and interpretations based on the supplied district dataset. Verify important information against the original sources. AI-generated interpretations may contain errors.",
                Math.min(finalY + 15, 250),
                { fontSize: 8 }
            );

            addPageFooters(doc);

            doc.save(
                `hawaii-${chamber}-district-${districtNumber}-profile.pdf`
            );

        } catch (err) {
            console.error(err);

            error = "Could not generate the PDF: " + err.message;

        } finally {
            isGeneratingPDF = false;
        }
    }
</script>

<svelte:head>
    <title>District Profile Generator | Know Your District</title>
    <meta
        name="description"
        content="Generate an AI-assisted Hawaii legislative district profile."
    />
</svelte:head>

<div class="report-container">
    <div class="report-header">
        <div class="eyebrow">KNOW YOUR DISTRICT</div>

        <h1>District Profile Generator</h1>

        <p>
            Generate an informative report about a Hawaii
            legislative district using district statistics
            and AI-assisted analysis.
        </p>
    </div>

    <div class="generator-card">
        <div class="card-heading">
            <h2>Choose a district</h2>
            <p>Select a legislative chamber and district number.</p>
        </div>

        <div class="form-row">
            <div class="field">
                <label for="chamber">Chamber</label>

                <select
                    id="chamber"
                    bind:value={chamber}
                    onchange={() => {
                        districtNumber = "1";
                        profile = null;
                        districtData = null;
                        datasetMetadata = null;
                        error = "";
                    }}
                    disabled={isLoading || isGeneratingPDF}
                >
                    <option value="senate">State Senate</option>
                    <option value="house">State House</option>
                </select>
            </div>

            <div class="field">
                <label for="district">District</label>

                <select
                    id="district"
                    bind:value={districtNumber}
                    disabled={isLoading || isGeneratingPDF}
                >
                    {#each Array.from(
                        { length: districtCount },
                        (_, i) => String(i + 1)
                    ) as number}
                        <option value={number}>
                            District {number}
                        </option>
                    {/each}
                </select>
            </div>
        </div>

        <button
            class="primary-button"
            onclick={generateProfile}
            disabled={isLoading || isGeneratingPDF}
        >
            {#if isLoading}
                <span class="spinner"></span>
                Generating profile...
            {:else}
                Generate district profile
            {/if}
        </button>

        <div class="model-note">
            <span class="status-dot"></span>
            Powered by local Ollama · {MODEL}
        </div>
    </div>

    {#if error}
        <div class="error-message" role="alert">
            <strong>Something went wrong</strong>
            <p>{error}</p>
        </div>
    {/if}

    {#if profile}
        <div class="profile-card">
            <div class="profile-top">
                <div>
                    <div class="eyebrow">GENERATED REPORT</div>
                    <h2>{profile.title}</h2>
                    <p>{profile.subtitle || districtLabel}</p>
                </div>

                <div class="report-icon">PDF</div>
            </div>

            <div class="profile-overview">
                <h3>District Overview</h3>
                <p>{profile.overview}</p>
            </div>

            <div class="profile-sections">
                {#each profile.sections || [] as section, i}
                    <section class="profile-section">
                        <h3>{section.heading}</h3>
                        <p>{section.content}</p>
                    </section>
                {/each}
            </div>

            {#if profile.notable_findings?.length}
                <section class="profile-section">
                    <h3>Notable Findings</h3>

                    <ul>
                        {#each profile.notable_findings as finding}
                            <li>{finding}</li>
                        {/each}
                    </ul>
                </section>
            {/if}

            {#if profile.limitations?.length}
                <section class="limitations">
                    <h3>Data Limitations</h3>

                    <ul>
                        {#each profile.limitations as limitation}
                            <li>{limitation}</li>
                        {/each}
                    </ul>
                </section>
            {/if}

            <div class="download-area">
                <div>
                    <strong>Your report is ready</strong>
                    <p>
                        Includes AI-generated explanations,
                        original statistics, and dataset metadata.
                    </p>
                </div>

                <button
                    class="download-button"
                    onclick={downloadPDF}
                    disabled={isGeneratingPDF}
                >
                    {#if isGeneratingPDF}
                        Preparing PDF...
                    {:else}
                        <span>↓</span>
                        Download PDF
                    {/if}
                </button>
            </div>

            <p class="disclaimer">
                AI-generated content may contain errors.
                Always verify important information against
                the original government sources.
            </p>
        </div>
    {/if}

    <button onclick={() => {goto("./")}}>go back home</button>
</div>


<style>
.report-container {
    width: 100%;
    max-width: 850px;
    margin: 0 auto;
    padding: 2rem 1rem 4rem;
}

.report-header {
    margin-bottom: 2rem;
}

.eyebrow {
    color: var(--pico-primary);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    margin-bottom: 0.5rem;
}

.report-header h1 {
    margin-bottom: 0.5rem;
}

.report-header p {
    max-width: 650px;
    color: var(--pico-muted-color);
}

.generator-card,
.profile-card {
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    border: 1px solid var(--pico-muted-border-color);
    border-radius: var(--pico-border-radius);
    background: var(--pico-card-background-color);
}

.card-heading h2 {
    margin-bottom: 0.35rem;
}

.card-heading p {
    color: var(--pico-muted-color);
    font-size: 0.9rem;
}

.form-row {
    display: flex;
    gap: 1rem;
}

.form-row .field {
    flex: 1;
    min-width: 0;
}

.primary-button {
    width: 100%;
    margin-bottom: 0;
}

.model-note {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 1rem;
    color: var(--pico-muted-color);
    font-size: 0.8rem;
}

.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #37a66a;
}

.spinner {
    display: inline-block;
    width: 0.85rem;
    height: 0.85rem;
    margin-right: 0.5rem;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    vertical-align: middle;
}

@keyframes spin {
    to {
        transform: rotate(360deg);
    }
}

/* Error state */

.error-message {
    padding: 1rem;
    margin-top: 1.5rem;
    border: 1px solid #c0392b;
    border-radius: var(--pico-border-radius);
    background: var(--pico-card-background-color);
    color: #c0392b;
}

.error-message p {
    margin-bottom: 0;
}

/* Generated Profile */

.profile-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid var(--pico-muted-border-color);
}

.profile-top h2 {
    margin-bottom: 0.25rem;
}

.profile-top p {
    margin-bottom: 0;
    color: var(--pico-muted-color);
}

.report-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 3rem;
    height: 3rem;
    border-radius: var(--pico-border-radius);
    background: var(--pico-mark-background-color);
    color: var(--pico-primary);
    font-size: 0.8rem;
    font-weight: 700;
}

.profile-overview {
    padding: 1.5rem 0;
}

.profile-overview h3,
.profile-section h3,
.limitations h3 {
    font-size: 1.05rem;
    margin-bottom: 0.75rem;
}

.profile-overview p,
.profile-section p,
.profile-section li,
.limitations li {
    line-height: 1.75;
}

.profile-section {
    padding: 1.25rem 0;
    border-top: 1px solid var(--pico-muted-border-color);
}

.profile-section p {
    margin-bottom: 0;
    white-space: pre-line;
}

.profile-section ul,
.limitations ul {
    padding-left: 1.5rem;
    margin-bottom: 0;
}

.limitations {
    padding: 1rem;
    margin-top: 1rem;
    border-radius: var(--pico-border-radius);
    background: var(--pico-code-background-color);
}

/* Download */

.download-area {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    padding-top: 1.5rem;
    margin-top: 1.5rem;
    border-top: 1px solid var(--pico-muted-border-color);
}

.download-area strong {
    display: block;
    margin-bottom: 0.25rem;
}

.download-area p {
    margin-bottom: 0;
    color: var(--pico-muted-color);
    font-size: 0.85rem;
}

.download-button {
    flex-shrink: 0;
    margin-bottom: 0;
    white-space: nowrap;
}

.disclaimer {
    margin-top: 1rem;
    margin-bottom: 0;
    color: var(--pico-muted-color);
    font-size: 0.8rem;
    line-height: 1.6;
}

/* Mobile */

@media (max-width: 600px) {
    .report-container {
        padding: 1.5rem 0.75rem 3rem;
    }

    .generator-card,
    .profile-card {
        padding: 1rem;
    }

    .form-row {
        flex-direction: column;
        gap: 0;
    }

    .download-area {
        align-items: stretch;
        flex-direction: column;
    }

    .download-button {
        width: 100%;
    }
}
</style>