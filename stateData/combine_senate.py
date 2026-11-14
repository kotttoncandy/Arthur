import json
from pathlib import Path

# Directory containing your JSON files
BASE_DIR = Path(__file__).parent

FILES = {
    "houseDemographics": "./house/json/houseDemographics.json",
    "houseHold": "./house/json/houseHomeDemographics.json",
    "houseHousingCharacteristics": "./house/json/houseHouseCharacteristics.json",
    "houseEmployment": "./house/json/houseEmployment.json"
}

combined = {}

for category, filename in FILES.items():

    filepath = BASE_DIR / filename

    print(f"Loading {filename}...")

    with open(filepath, "r", encoding="utf-8") as file:
        data = json.load(file)

    # Match information using district numbers
    for district, statistics in data.items():

        combined.setdefault(str(district), {})

        combined[str(district)][category] = statistics


# Sort districts numerically
combined = dict(
    sorted(combined.items(), key=lambda item: int(item[0]))
)

# Export combined JSON
output_file = BASE_DIR / "senate.json"

with open(output_file, "w", encoding="utf-8") as file:
    json.dump(
        combined,
        file,
        indent=4,
        ensure_ascii=False
    )

print("\nSuccessfully combined Senate datasets!")
print(f"Districts: {len(combined)}")
print(f"Output: {output_file}")