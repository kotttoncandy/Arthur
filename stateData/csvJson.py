import pandas as pd
import json
import sys
import re


def parse_value(value):
    """Convert values into numbers when possible."""

    if pd.isna(value):
        return None

    value = str(value).strip()

    if value in ["", "-", "—", "N/A", "(X)"]:
        return None

    cleaned = value.replace(",", "").replace("$", "").replace("%", "")

    try:
        number = float(cleaned)

        if number.is_integer():
            return int(number)

        return number

    except ValueError:
        return value


def normalize_metric(value):
    """Standardize column names."""

    value = str(value).strip().lower()

    if "percent" in value and ("margin" in value or "moe" in value):
        return "percent_margin_of_error"

    if "percent" in value:
        return "percent"

    if "margin" in value or value == "moe":
        return "margin_of_error"

    if "estimate" in value:
        return "estimate"

    return None


def parse_csv(input_file, output_file):

    df = pd.read_csv(input_file, header=None, dtype=str)

    # First header row: district names
    district_headers = df.iloc[0].tolist()

    # Second header row: Estimate, MOE, Percent, Percent MOE
    metric_headers = df.iloc[1].tolist()

    # Identify which columns belong to each district
    district_columns = {}

    current_district = None

    for col in range(1, df.shape[1]):

        district = district_headers[col]

        # Handle merged Excel headers saved as blank CSV cells
        if pd.notna(district) and str(district).strip():
            current_district = re.search(
                r"District (\d+)",
                str(district)
            ).group(1)

        metric = normalize_metric(metric_headers[col])

        if current_district and metric:

            district_columns.setdefault(current_district, {})
            district_columns[current_district][metric] = col

    # Build JSON
    result = {}

    for district, columns in district_columns.items():

        result[district] = {}

        for row in range(2, len(df)):

            label = df.iloc[row, 0]

            if pd.isna(label) or not str(label).strip():
                continue

            label = str(label).strip()

            result[district][label] = {
                "estimate": parse_value(
                    df.iloc[row, columns["estimate"]]
                ) if "estimate" in columns else None,

                "margin_of_error": parse_value(
                    df.iloc[row, columns["margin_of_error"]]
                ) if "margin_of_error" in columns else None,

                "percent": parse_value(
                    df.iloc[row, columns["percent"]]
                ) if "percent" in columns else None,

                "percent_margin_of_error": parse_value(
                    df.iloc[row, columns["percent_margin_of_error"]]
                ) if "percent_margin_of_error" in columns else None
            }

    # Export JSON
    with open(output_file, "w", encoding="utf-8") as file:
        json.dump(result, file, indent=4, ensure_ascii=False)

    print(f"Parsed {len(result)} districts.")
    print(f"Saved to {output_file}")


if __name__ == "__main__":

    input_file = sys.argv[1] if len(sys.argv) > 1 else "districts.csv"
    output_file = sys.argv[2] if len(sys.argv) > 2 else "districts.json"

    parse_csv(input_file, output_file)