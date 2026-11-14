import { get } from "svelte/store";
import { messages as history } from "../lib/messages";

// ==========================================
// DATA FILES
// ==========================================

const DATA_PATHS = {
    Senate: "/data/senate.json",
    House: "/data/house.json"
};

const PROGRAMS_PATH = "/data/programs.json";

const dataCache = {
    Senate: null,
    House: null
};

let programsCache = null;

// ==========================================
// CATEGORY DEFINITIONS
// ==========================================

const CATEGORY_MAPS = {
    Senate: {
        AgeSex: "AgeSex",
        Employed: "Employed",
        Household: "Household",
        Housing: "Housing"
    },

    House: {
        Demographics: "houseDemographics",
        Household: "houseHold",
        Housing: "houseHousingCharacteristics",
        Employment: "houseEmployment"
    }
};

// ==========================================
// DISTRICT DATA LOADING
// ==========================================

async function loadDistrictData(chamber) {
    if (!DATA_PATHS[chamber]) {
        throw new Error(`Unknown chamber: ${chamber}`);
    }

    if (!dataCache[chamber]) {
        const path = DATA_PATHS[chamber];

        dataCache[chamber] = fetch(path).then(async response => {
            if (!response.ok) {
                throw new Error(
                    `Failed to load ${path}: ${response.status}`
                );
            }

            return response.json();
        });
    }

    try {
        return await dataCache[chamber];
    } catch (error) {
        dataCache[chamber] = null;
        throw error;
    }
}

// ==========================================
// GOVERNMENT PROGRAM DATA LOADING
// ==========================================

async function loadProgramDatabase() {
    if (!programsCache) {
        programsCache = fetch(PROGRAMS_PATH).then(async response => {
            if (!response.ok) {
                throw new Error(
                    `Failed to load government programs database: ${response.status}`
                );
            }

            const data = await response.json();

            // The database must contain metadata and programs.
            if (
                !data ||
                typeof data !== "object" ||
                Array.isArray(data) ||
                !Array.isArray(data.programs)
            ) {
                throw new Error(
                    "Invalid programs database. Expected an object containing a programs array."
                );
            }

            return data;
        });
    }

    try {
        return await programsCache;
    } catch (error) {
        programsCache = null;
        throw error;
    }
}

async function loadPrograms() {
    const database = await loadProgramDatabase();
    return database.programs;
}

// ==========================================
// DISTRICT METADATA HELPERS
// ==========================================

function getMetadata(data) {
    const metadata = data?.metadata;

    if (
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
    ) {
        return {
            metadata_available: false,
            source: null,
            dataset_name: null,
            period: null,
            geography: null,
            geography_vintage: null,
            methodology: null,
            source_url: null,
            limitations: null
        };
    }

    return {
        metadata_available: true,
        ...metadata
    };
}

async function get_dataset_metadata({ chamber } = {}) {
    const normalizedChamber = String(chamber ?? "")
        .trim()
        .toLowerCase();

    const chamberNames = {
        senate: "Senate",
        house: "House"
    };

    const actualChamber = chamberNames[normalizedChamber];

    if (!actualChamber) {
        return {
            error: "Invalid chamber. Use senate or house."
        };
    }

    try {
        const data = await loadDistrictData(actualChamber);
        const metadata = getMetadata(data);

        return {
            chamber: normalizedChamber,
            ...metadata
        };
    } catch (error) {
        return {
            chamber: normalizedChamber,
            metadata_available: false,
            error: error.message
        };
    }
}

// ==========================================
// DISTRICT SOURCE NOTE FORMATTING
// ==========================================

function formatMetadataValue(metadata, possibleKeys) {
    for (const key of possibleKeys) {
        const value = metadata?.[key];

        if (
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ""
        ) {
            return String(value);
        }
    }

    return "Not verified in dataset metadata";
}

function formatSourceNote(chamber, metadata) {
    const lines = [
        `**Data source — ${chamber} districts`,

        `- Source: ${formatMetadataValue(
            metadata,
            ["source", "original_source", "publisher"]
        )}`,

        `- Dataset: ${formatMetadataValue(
            metadata,
            ["dataset_name", "source_dataset", "dataset"]
        )}`,

        `- Period: ${formatMetadataValue(
            metadata,
            [
                "survey_period",
                "period",
                "year",
                "data_year",
                "publication_period"
            ]
        )}`,

        `- Geography: ${formatMetadataValue(
            metadata,
            [
                "geography",
                "geographic_level",
                "geographic_coverage"
            ]
        )}`,

        `- Boundary vintage: ${formatMetadataValue(
            metadata,
            [
                "geography_vintage",
                "boundary_vintage",
                "geographic_vintage"
            ]
        )}`,

        `- Method: ${formatMetadataValue(
            metadata,
            [
                "methodology",
                "method",
                "estimation_method"
            ]
        )}`,

        `- Margin of error: ${formatMetadataValue(
            metadata,
            ["margin_of_error", "moe"]
        )}`
    ];

    const sourceUrl = formatMetadataValue(
        metadata,
        ["source_url", "url"]
    );

    if (sourceUrl !== "Not verified in dataset metadata") {
        lines.push(`- Source link: ${sourceUrl}`);
    }

    const limitations = metadata?.limitations;

    if (Array.isArray(limitations) && limitations.length > 0) {
        lines.push(
            `- Limitations: ${limitations.join("; ")}`
        );
    } else if (
        typeof limitations === "string" &&
        limitations.trim()
    ) {
        lines.push(`- Limitations: ${limitations}`);
    }

    if (!metadata?.metadata_available) {
        lines.push(
            "- **Notice:** This dataset does not currently contain verified metadata. The source and methodology have not been confirmed."
        );
    }

    return `\n\n---\n\n${lines.join("\n")}`;
}

// ==========================================
// SHARED DISTRICT DATA RETRIEVAL
// ==========================================

async function getDistrictData(
    chamber,
    district,
    category,
    indicator
) {
    district = String(district ?? "").trim();

    if (!/^\d+$/.test(district)) {
        throw new Error(
            `Invalid ${chamber} district number.`
        );
    }

    const data = await loadDistrictData(chamber);
    const metadata = getMetadata(data);

    const metadataFields = {
        metadata_available: metadata.metadata_available,
        metadata
    };

    // Verify district exists.

    if (!Object.hasOwn(data, district)) {
        return {
            error: `${chamber} District ${district} was not found.`,

            available_districts: Object.keys(data).filter(
                key => /^\d+$/.test(key)
            ),

            ...metadataFields
        };
    }

    const districtData = data[district];
    const categories = Object.keys(districtData);

    let selectedCategories = categories;

    // CATEGORY FILTERING

    if (category?.trim()) {
        const requestedCategory = category
            .trim()
            .toLowerCase();

        const categoryMap = CATEGORY_MAPS[chamber];

        const selected = Object.entries(categoryMap).find(
            ([displayName, dataKey]) =>
                displayName.toLowerCase() === requestedCategory ||
                dataKey.toLowerCase() === requestedCategory
        );

        if (!selected) {
            return {
                error: `Category ${category} was not found.`,
                available_categories: Object.keys(categoryMap),
                ...metadataFields
            };
        }

        const dataKey = selected[1];

        if (!categories.includes(dataKey)) {
            return {
                error: `Category ${category} is unavailable for this district.`,
                available_categories: Object.keys(categoryMap),
                ...metadataFields
            };
        }

        selectedCategories = [dataKey];
    }

    // RETRIEVE STATISTICS

    const results = {};

    for (const categoryName of selectedCategories) {
        const categoryData = districtData[categoryName];

        if (
            !categoryData ||
            typeof categoryData !== "object" ||
            Array.isArray(categoryData)
        ) {
            continue;
        }

        let entries = Object.entries(categoryData).filter(
            ([, stats]) =>
                stats &&
                typeof stats === "object" &&
                !Array.isArray(stats) &&
                Object.values(stats).some(value => value != null)
        );

        // INDICATOR FILTERING

        if (indicator?.trim()) {
            const query = indicator
                .toLowerCase()
                .trim();

            let matches = entries.filter(
                ([label]) => label.toLowerCase() === query
            );

            if (matches.length === 0) {
                matches = entries.filter(
                    ([label]) =>
                        label.toLowerCase().includes(query)
                );
            }

            if (matches.length === 0) {
                const words = query.split(/\s+/);

                matches = entries.filter(([label]) => {
                    const normalized = label.toLowerCase();

                    return words.every(word =>
                        normalized.includes(word)
                    );
                });
            }

            entries = matches;
        }

        if (entries.length > 0) {
            results[categoryName] = Object.fromEntries(entries);
        }
    }

    // NO MATCHING STATISTICS

    if (Object.keys(results).length === 0) {
        const availableIndicators = selectedCategories.flatMap(
            name =>
                Object.keys(districtData[name] ?? {}).filter(label => {
                    const stats = districtData[name][label];

                    return (
                        stats &&
                        typeof stats === "object" &&
                        !Array.isArray(stats) &&
                        Object.values(stats).some(value => value != null)
                    );
                })
        );

        return {
            error: "No matching statistics found.",

            available_categories: Object.keys(
                CATEGORY_MAPS[chamber]
            ),

            available_indicators: availableIndicators,

            ...metadataFields
        };
    }

    return {
        chamber,
        district,
        statistics: results,
        ...metadataFields
    };
}

// ==========================================
// GOVERNMENT PROGRAM HELPERS
// ==========================================

function normalizeText(value) {
    if (value === undefined || value === null) {
        return "";
    }

    if (Array.isArray(value)) {
        return value.map(normalizeText).join(" ");
    }

    if (typeof value === "object") {
        return Object.values(value)
            .map(normalizeText)
            .join(" ");
    }

    return String(value).toLowerCase();
}

function getProgramSearchText(program) {
    return normalizeText([
        program.id,
        program.name,
        program.abbreviation,
        program.category,
        program.agency,
        program.description,
        program.benefit_type,
        program.eligibility,
        program.income_limits,
        program.application_url,
        program.source_url,
        program.verification,
        program.status,
        program.program_components
    ]);
}

// ==========================================
// PROGRAM DATABASE METADATA
// ==========================================

async function getProgramDatabaseMetadata() {
    const database = await loadProgramDatabase();

    const metadata = database.metadata ?? {};
    const actualCount = database.programs.length;
    const declaredCount = metadata.program_count ?? null;

    return {
        metadata_available: Object.keys(metadata).length > 0,

        metadata,

        actual_program_count: actualCount,

        declared_program_count: declaredCount,

        count_matches:
            declaredCount === null
                ? null
                : Number(declaredCount) === actualCount,

        notice:
            "Database metadata describes the dataset. It does not independently verify that every program record is current or accurate."
    };
}

// ==========================================
// SEARCH GOVERNMENT PROGRAMS
// ==========================================

async function searchGovernmentPrograms({
    query,
    category,
    geography
} = {}) {
    const programs = await loadPrograms();

    const normalizedQuery = String(query ?? "")
        .trim()
        .toLowerCase();

    const normalizedCategory = String(category ?? "")
        .trim()
        .toLowerCase();

    const normalizedGeography = String(geography ?? "")
        .trim()
        .toLowerCase();

    let results = programs.map(program => {
        const searchableText = getProgramSearchText(program);

        let score = 0;

        if (normalizedQuery) {
            const terms = normalizedQuery
                .split(/\s+/)
                .filter(Boolean);

            for (const term of terms) {
                const name = normalizeText([
                    program.name,
                    program.abbreviation
                ]);

                const categories = normalizeText(program.category);

                if (name.includes(term)) {
                    score += 5;
                } else if (categories.includes(term)) {
                    score += 3;
                } else if (searchableText.includes(term)) {
                    score += 1;
                }
            }

            if (score === 0) {
                return null;
            }
        }

        return {
            program,
            score
        };
    }).filter(Boolean);

    // CATEGORY FILTER

    if (normalizedCategory) {
        results = results.filter(({ program }) => {
            const programCategory = normalizeText(
                program.category
            );

            return programCategory.includes(normalizedCategory);
        });
    }

    // GEOGRAPHY FILTER
    //
    // Only include records that explicitly identify the requested
    // geography, statewide coverage, or federal coverage.
    // Missing geography is not treated as confirmed coverage.

    if (normalizedGeography) {
        results = results.filter(({ program }) => {
            const programGeography = normalizeText(
                program.geography
            );

            return (
                programGeography.includes(normalizedGeography) ||
                programGeography.includes("statewide") ||
                programGeography.includes("federal")
            );
        });
    }

    results.sort((a, b) => b.score - a.score);

    return {
        total_results: results.length,

        search_parameters: {
            query: normalizedQuery || null,
            category: normalizedCategory || null,
            geography: normalizedGeography || null
        },

        geography_notice: normalizedGeography
            ? "Programs without explicit geographic coverage information are excluded from geographically filtered results."
            : "Geographic coverage is included only when it is specified in a program record.",

        programs: results.slice(0, 8).map(({ program }) => ({
            id: program.id,
            name: program.name,
            abbreviation: program.abbreviation,
            category: program.category,
            agency: program.agency,
            description: program.description,
            benefit_type: program.benefit_type,
            eligibility: program.eligibility,
            income_limits: program.income_limits,
            application_url: program.application_url,
            source_url: program.source_url,
            verification: program.verification,
            status: program.status,
            geography: program.geography ?? null
        }))
    };
}

// ==========================================
// GET GOVERNMENT PROGRAM DETAILS
// ==========================================

async function getProgramDetails({ program_id } = {}) {
    const programs = await loadPrograms();

    const id = String(program_id ?? "")
        .trim()
        .toLowerCase();

    if (!id) {
        return {
            error: "A program ID is required."
        };
    }

    const program = programs.find(item =>
        String(item.id ?? "").toLowerCase() === id
    );

    if (!program) {
        return {
            error: `Program "${id}" was not found.`,

            available_programs: programs.map(item => ({
                id: item.id,
                name: item.name
            }))
        };
    }

    return {
        ...program,

        database_notice:
            "This record is informational only. It does not determine whether an individual qualifies for the program. Verify current requirements with the administering agency."
    };
}

// ==========================================
// GET PROGRAM CATEGORIES
// ==========================================

async function getProgramCategories() {
    const programs = await loadPrograms();

    const categories = [
        ...new Set(
            programs.flatMap(program => {
                const values = [
                    program.category,
                    ...(Array.isArray(program.categories)
                        ? program.categories
                        : [])
                ];

                return values.filter(Boolean);
            })
        )
    ];

    return {
        total_programs: programs.length,
        categories: categories.sort()
    };
}

// ==========================================
// TOOL IMPLEMENTATIONS
// ==========================================

const availableTools = {
    get_current_time: () => {
        return new Intl.DateTimeFormat("en-US", {
            timeZone: "Pacific/Honolulu",
            dateStyle: "full",
            timeStyle: "long"
        }).format(new Date());
    },

    get_senate_data: async ({
        district,
        category,
        indicator
    } = {}) => {
        return getDistrictData(
            "Senate",
            district,
            category,
            indicator
        );
    },

    get_house_data: async ({
        district,
        category,
        indicator
    } = {}) => {
        return getDistrictData(
            "House",
            district,
            category,
            indicator
        );
    },

    get_dataset_metadata: async (args = {}) => {
        return get_dataset_metadata(args);
    },

    search_government_programs: async (args = {}) => {
        return searchGovernmentPrograms(args);
    },

    get_program_details: async (args = {}) => {
        return getProgramDetails(args);
    },

    get_program_categories: async () => {
        return getProgramCategories();
    },

    get_program_database_metadata: async () => {
        return getProgramDatabaseMetadata();
    }
};

// ==========================================
// TOOL DEFINITIONS FOR QWEN
// ==========================================

const tools = [

    // CURRENT TIME

    {
        type: "function",
        function: {
            name: "get_current_time",
            description:
                "Gets the current date and time in Hawaiʻi.",
            parameters: {
                type: "object",
                properties: {}
            }
        }
    },

    // SENATE DATA

    {
        type: "function",
        function: {
            name: "get_senate_data",

            description: `
Retrieves demographic and socioeconomic statistics for a specific Hawaiʻi State Senate district.

There are 25 Senate districts, numbered 1 through 25.

AVAILABLE CATEGORIES:

AgeSex:
Population, sex, age, race, Hispanic or Latino origin, citizenship, and voting-age population.

Employed:
Employment status, commuting, occupations, industries, class of worker, income, health insurance, and poverty.

Household:
Household types, relationships, marital status, fertility, grandparents, education, veteran status, disability, residence, birthplace, citizenship, language, ancestry, and computer and internet use.

Housing:
Housing occupancy, structure types, year built, rooms, bedrooms, housing tenure, vehicles, heating fuel, value, mortgage status, ownership costs, and rent.

TOOL USAGE:
- Use this tool whenever the user requests statistics about a specific Senate district.
- For a specific statistic, provide its matching category and indicator.
- For a general overview or multiple statistics, omit category and indicator.
- Use the exact category identifiers: AgeSex, Employed, Household, Housing.
- Do not confuse Senate districts with House districts.

DATA ACCURACY:
- Never invent missing statistics.
- Preserve original statistic names.
- Report estimates and margins of error separately.
- Include percentages when available.
- Never confuse estimates with percentages.
- Explain margins of error when interpreting results.
- If a statistic is unavailable, communicate that clearly.

METADATA:
This tool automatically returns dataset metadata with its statistics. Read the metadata in the tool result and use it in your answer. Do not call get_dataset_metadata again just to obtain metadata you already received.
            `,

            parameters: {
                type: "object",
                properties: {
                    district: {
                        type: "string",
                        description: "Senate district number, from 1 to 25."
                    },

                    category: {
                        type: "string",
                        enum: [
                            "AgeSex",
                            "Employed",
                            "Household",
                            "Housing"
                        ],
                        description: "Dataset category to retrieve."
                    },

                    indicator: {
                        type: "string",
                        description: "Specific statistic to retrieve."
                    }
                },
                required: ["district"]
            }
        }
    },

    // HOUSE DATA

    {
        type: "function",
        function: {
            name: "get_house_data",

            description: `
Retrieves demographic, employment, household, and housing statistics for a specific Hawaiʻi State House district.

There are 51 House districts, numbered 1 through 51.

AVAILABLE CATEGORIES:

Demographics:
Population, age, sex, race, Hispanic or Latino origin, citizenship, ancestry, and language.

Household:
Household types, relationships, marital status, fertility, grandparents, education, disability, residence, birthplace, language, ancestry, and computer and internet use.

Housing:
Housing characteristics and housing-related statistics.

Employment:
Employment status, occupations, and industries.

TOOL USAGE:
- Use this tool whenever the user asks about statistics for a specific House district.
- For a specific statistic, provide its matching category and indicator.
- For a general overview or multiple statistics, omit category and indicator.
- Use the exact category identifiers: Demographics, Household, Housing, Employment.
- Do not confuse House districts with Senate districts.

DATA ACCURACY:
- Never invent missing statistics.
- Preserve original statistic names.
- Report estimates and margins of error accurately.
- Include percentages when available.
- Distinguish estimates from exact counts.
- If a statistic is unavailable, communicate that clearly.

METADATA:
This tool automatically returns dataset metadata with its statistics. Read the metadata in the tool result and use it in your answer. Do not call get_dataset_metadata again just to obtain metadata you already received.
            `,

            parameters: {
                type: "object",
                properties: {
                    district: {
                        type: "string",
                        description: "House district number, from 1 to 51."
                    },

                    category: {
                        type: "string",
                        enum: [
                            "Demographics",
                            "Household",
                            "Housing",
                            "Employment"
                        ],
                        description: "Dataset category to retrieve."
                    },

                    indicator: {
                        type: "string",
                        description: "Specific statistic to retrieve."
                    }
                },
                required: ["district"]
            }
        }
    },

    // DISTRICT DATASET METADATA

    {
        type: "function",
        function: {
            name: "get_dataset_metadata",

            description: `
Retrieves source and methodology information about the demographic datasets used by Know Your District.

Use this tool when the user asks specifically about the source, survey year, geographic boundaries, or methodology of a dataset.

Statistical data tools already return metadata automatically, so do not call this tool again if the metadata is already present in the tool result.

Never invent missing metadata or substitute information from another dataset.
            `,

            parameters: {
                type: "object",
                properties: {
                    chamber: {
                        type: "string",
                        enum: ["senate", "house"],
                        description:
                            "The legislative chamber whose dataset metadata is requested."
                    }
                },
                required: ["chamber"]
            }
        }
    },

    // SEARCH GOVERNMENT PROGRAMS

    {
        type: "function",
        function: {
            name: "search_government_programs",

            description: `
Searches the Know Your District government assistance database.

Use this tool when a resident asks about public assistance, government benefits, or programs that may help with their needs.

Examples:
- Food assistance
- Help paying rent
- Housing assistance
- Healthcare coverage
- Childcare assistance
- Education assistance
- Financial assistance
- Employment assistance
- Disability assistance
- Utility bill assistance
- Veteran assistance

Search using the resident's stated needs.

The database may include Hawaiʻi state programs and federal programs available to Hawaiʻi residents.

IMPORTANT:
- Search results are potential matches, not confirmed eligibility.
- Do not claim that a person qualifies based only on a search result.
- Do not invent programs that are not returned.
- Use get_program_details when more information about a specific program is needed.
- Geographic coverage may be missing from some records. Do not assume coverage when it is not specified.
            `,

            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description:
                            "The resident's need or search terms. Examples: help paying rent, food assistance, or healthcare."
                    },

                    category: {
                        type: "string",
                        description:
                            "Optional category filter, such as Housing, Food Assistance, Healthcare, or Education."
                    },

                    geography: {
                        type: "string",
                        description:
                            "Optional geographic filter, such as Oahu, Statewide, or Federal. Only records with explicit matching coverage are returned."
                    }
                }
            }
        }
    },

    // GET GOVERNMENT PROGRAM DETAILS

    {
        type: "function",
        function: {
            name: "get_program_details",

            description: `
Retrieves the complete database record for a specific government assistance program.

Use this after finding a program through search_government_programs.

The record may include:
- Program description
- Administering agency
- Benefits
- Eligibility requirements
- Income limits
- Application instructions
- Official application links
- Source information
- Verification information
- Known limitations

IMPORTANT:
- Never invent missing requirements.
- Never guarantee eligibility.
- Do not present general eligibility rules as a personal eligibility determination.
- Always identify the official source and verification information when available.
            `,

            parameters: {
                type: "object",
                properties: {
                    program_id: {
                        type: "string",
                        description:
                            "The exact program ID returned by search_government_programs."
                    }
                },
                required: ["program_id"]
            }
        }
    },

    // GET PROGRAM CATEGORIES

    {
        type: "function",
        function: {
            name: "get_program_categories",

            description: `
Returns the categories and total number of programs currently available in the government assistance database.

Use this when the user asks what types of assistance are included in the database.
            `,

            parameters: {
                type: "object",
                properties: {}
            }
        }
    },

    // GET PROGRAM DATABASE METADATA

    {
        type: "function",
        function: {
            name: "get_program_database_metadata",

            description: `
Retrieves metadata about the government assistance database.

Use this when the user asks:
- How many programs are in the database.
- When the database was last updated.
- What version of the database is being used.
- What jurisdiction the database covers.
- What the database is intended to contain.
- What verification policy or disclaimer applies.

Use the actual metadata returned by the tool. Do not invent missing metadata.
            `,

            parameters: {
                type: "object",
                properties: {}
            }
        }
    }
];

// ==========================================
// STREAMING CHAT FUNCTION
// ==========================================

export async function chat(message, onToken, signal) {

    const messages = [
        {
            role: "system",

            content: `
You are Arthur, the AI assistant for Know Your District.

Your purpose is to help people understand Hawaiʻi legislative districts using demographic, employment, household, and housing datasets, as well as information about government assistance programs.

You provide clear, accurate, and useful information to Hawaiʻi residents.

========================================
AVAILABLE DATA TOOLS
========================================

DISTRICT STATISTICS:

- get_senate_data: Retrieves statistics for Hawaiʻi Senate districts 1–25. Its result automatically includes dataset metadata.
- get_house_data: Retrieves statistics for Hawaiʻi House districts 1–51. Its result automatically includes dataset metadata.
- get_dataset_metadata: Retrieves source and methodology information for the Senate or House dataset.
- get_current_time: Retrieves the current date and time in Hawaiʻi.

GOVERNMENT PROGRAMS:

- search_government_programs: Searches the government assistance database by a resident's needs, category, or geographic coverage.
- get_program_details: Retrieves the full record for a specific government program.
- get_program_categories: Lists the categories currently available in the government programs database.
- get_program_database_metadata: Retrieves metadata about the government programs database.

========================================
DISTRICT STATISTICS TOOL USAGE
========================================

1. Always use the appropriate data tool when answering questions about district-specific statistics.
2. Determine whether the user means a House or Senate district. If unclear, ask the user to clarify.
3. Statistical data tools automatically include metadata. You MUST inspect that metadata and use it when answering.
4. Do not call get_dataset_metadata separately if the statistical tool result already contains the metadata.
5. If the user asks for general information or random facts about a district, retrieve the available data and select several interesting, varied statistics.
6. If the user asks about a specific statistic, retrieve the relevant category and indicator.
7. If the user asks about sources, survey years, geographic boundaries, or methodology without asking for statistics, use get_dataset_metadata.
8. Never claim to have retrieved data unless you actually used the appropriate tool.

========================================
GOVERNMENT PROGRAM TOOL USAGE
========================================

1. When a resident asks about public assistance, government benefits, or programs that may help with a need, use search_government_programs.
2. Search using the resident's actual need. For example, a request for help paying rent should be searched using terms related to rental or housing assistance.
3. Use get_program_details to retrieve the complete record for promising matches.
4. Use get_program_categories when the resident asks what types of programs are included in the database.
5. Use get_program_database_metadata when the resident asks about the database itself, including its version, update date, jurisdiction, or number of records.
6. Do not invent programs or recommend programs that were not returned by the database.
7. Do not assume a program is available in a particular location unless its record supports that.
8. Explain eligibility requirements in plain language.
9. Distinguish between general eligibility requirements and a confirmed personal eligibility determination.
10. Never guarantee that someone qualifies.
11. Never invent income limits, benefit amounts, deadlines, or application requirements.
12. Always provide the official application link when available.
13. Identify the administering agency and official source.
14. If verification information is missing, clearly state that the database does not provide it.
15. If a program record contains limitations, communicate relevant limitations.
16. If no matching program is found, say so. Do not fabricate an alternative.
17. Do not ask residents to share sensitive personal information such as Social Security numbers, bank details, immigration documents, or medical records.
18. If eligibility depends on personal circumstances, explain what factors generally matter and direct the resident to the administering agency for an official determination.
19. Do not treat the database's last_updated date as proof that every individual program record has been verified on that date.
20. Do not describe a program as currently accepting applications unless the record or an official source explicitly confirms it.

========================================
ANSWERING RULES
========================================

1. Answer the user's actual question directly.
2. When asked for facts, provide the facts themselves. Do not explain the structure of JSON or describe its fields.
3. For requests for random district facts, provide approximately five interesting facts.
4. Choose facts from different categories when possible.
5. Include actual estimates and percentages when available.
6. Explain what each statistic means in plain language.
7. Use bullet points for multiple facts.
8. Give enough context for numbers to be meaningful.
9. Do not make unsupported conclusions or claim that a statistic proves something it does not.
10. Do not invent statistics or fill in missing values.

========================================
STATISTICAL ACCURACY
========================================

- Preserve original estimates and margins of error.
- Distinguish estimates from exact counts.
- Include margins of error when available and relevant.
- Do not confuse counts, percentages, or different population universes.
- If a statistic is unavailable, say so.
- Do not calculate percentages from unrelated denominators.

========================================
DATA TRANSPARENCY
========================================

- Every answer that uses district statistics must identify the dataset source, period/year, and geographic level.
- Include the methodology (direct estimate or apportionment) when the metadata provides it.
- Include boundary vintage and margin of error when provided and relevant.
- If a metadata field is missing, explicitly say it has not been verified. Never guess.
- Do not present an apportioned district figure as a direct measurement.
- If data is outdated, disclose its age when known.
- A concise source note is required even when the user does not explicitly ask for citations.

For government programs:
- Identify the official agency and source.
- Provide official application links when available.
- Clearly distinguish verified information from missing or unverified information.
- Never present the database as an official eligibility determination.
- Do not assume geographic coverage if the record does not specify it.
- Do not confuse the database's update date with an individual program's verification date.

========================================
SOURCE NOTE
========================================

The application will append a source note to statistical answers automatically.

Still use the metadata in your explanation when it helps the user understand the figures.

Do not invent a second source or contradict the metadata.

Government program records have their own source information. Include those sources in your answer when available. The application does not automatically append government program source notes.

========================================
COMMUNICATION STYLE
========================================

- Be conversational, clear, and concise.
- Avoid unnecessary technical language.
- Do not start with generic statements such as "It looks like you've provided a JSON-like structure."
- Do not repeat the user's question as an introduction.
- Do not give generic suggestions about analyzing or visualizing data unless the user asks.

Your goal is to turn district statistics and government program information into useful, understandable information for Hawaiʻi residents.
            `
        },

        ...get(history),

        {
            role: "user",
            content: message
        }
    ];

    const MAX_TOOL_ROUNDS = 5;

    // Track datasets used during this response.
    // The application, not Qwen, appends the source note.

    const datasetsUsed = new Map();

    // ======================================
    // TOOL CALLING LOOP
    // ======================================

    for (
        let round = 0;
        round <= MAX_TOOL_ROUNDS;
        round++
    ) {

        const response = await fetch(
            "http://localhost:11434/api/chat",
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                signal,

                body: JSON.stringify({
                    model: "qwen3:8b",
                    messages,
                    tools,
                    stream: true,
                    think: false
                })
            }
        );

        if (!response.ok) {
            throw new Error(
                `Ollama error: ${response.status}`
            );
        }

        if (!response.body) {
            throw new Error(
                "Ollama returned an empty response stream."
            );
        }

        // ==================================
        // READ STREAM
        // ==================================

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";
        let assistantContent = "";
        let toolCalls = [];

        function processChunk(line) {
            if (!line.trim()) return;

            let chunk;

            try {
                chunk = JSON.parse(line);
            } catch {
                console.error(
                    "Invalid Ollama stream chunk:",
                    line
                );

                return;
            }

            if (chunk.error) {
                throw new Error(chunk.error);
            }

            const content = chunk.message?.content ?? "";

            // Stream response to frontend.

            if (content) {
                assistantContent += content;
                onToken?.(content);
            }

            // Collect tool calls.

            if (chunk.message?.tool_calls) {
                toolCalls.push(
                    ...chunk.message.tool_calls
                );
            }
        }

        // ==================================
        // STREAM READER
        // ==================================

        try {
            while (true) {
                const { value, done } = await reader.read();

                if (value) {
                    buffer += decoder.decode(value, {
                        stream: true
                    });
                }

                if (done) {
                    buffer += decoder.decode();
                }

                const lines = buffer.split("\n");

                buffer = lines.pop() ?? "";

                for (const line of lines) {
                    processChunk(line);
                }

                if (done) break;
            }

            if (buffer.trim()) {
                processChunk(buffer);
            }

        } finally {
            reader.releaseLock();
        }

        // ==================================
        // SAVE ASSISTANT MESSAGE
        // ==================================

        const assistantMessage = {
            role: "assistant",
            content: assistantContent
        };

        if (toolCalls.length > 0) {
            assistantMessage.tool_calls = toolCalls;
        }

        messages.push(assistantMessage);

        // ==================================
        // CHECK FOR TOOL CALLS
        // ==================================

        if (toolCalls.length === 0) {

            // Append district source notes automatically.

            if (datasetsUsed.size > 0) {
                const sourceNotes = [
                    ...datasetsUsed.entries()
                ]
                    .map(([chamber, metadata]) =>
                        formatSourceNote(chamber, metadata)
                    )
                    .join("\n\n");

                assistantContent += sourceNotes;

                onToken?.(sourceNotes);
            }

            return assistantContent;
        }

        if (round === MAX_TOOL_ROUNDS) {
            throw new Error(
                "Maximum tool-calling rounds exceeded."
            );
        }

        // ==================================
        // EXECUTE TOOLS
        // ==================================

        for (const call of toolCalls) {
            const name = call.function.name;

            let args = call.function.arguments ?? {};

            // Normalize arguments in case Ollama returns a JSON string.

            if (typeof args === "string") {
                try {
                    args = JSON.parse(args);
                } catch {
                    args = {};
                }
            }

            console.log("Tool requested:", name);
            console.log("Arguments:", args);

            let result;

            if (!Object.hasOwn(availableTools, name)) {
                result = {
                    error: `Unknown tool: ${name}`
                };
            } else {
                try {
                    result = await availableTools[name](args);
                } catch (error) {
                    result = {
                        error: error.message
                    };
                }
            }

            // ==================================
            // TRACK DISTRICT DATASET METADATA
            // ==================================

            if (
                (
                    name === "get_senate_data" ||
                    name === "get_house_data"
                ) &&
                result &&
                typeof result === "object"
            ) {
                const chamber =
                    name === "get_senate_data"
                        ? "Senate"
                        : "House";

                datasetsUsed.set(
                    chamber,
                    result.metadata ?? {
                        metadata_available: false
                    }
                );
            }

            // ==================================
            // RETURN TOOL RESULT TO OLLAMA
            // ==================================

            messages.push({
                role: "tool",
                tool_name: name,
                content: JSON.stringify(result)
            });
        }

        // Continue loop.
        // Qwen receives tool results and generates its answer.
    }

    throw new Error(
        "The assistant could not complete the request."
    );
}