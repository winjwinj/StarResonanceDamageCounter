import json

# Load the input JSON
with open("TalentTable.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# Build mapping: Chinese "Des" -> English "TalentName$english"
mapping = {v["Des"]: v["TalentName$english"] for v in data.values()}

# Save result (overwrite or use a new file name)
with open("TalentTable_Mapping.json", "w", encoding="utf-8") as f:
    json.dump(mapping, f, ensure_ascii=False, indent=2)

print("TalentTable_Mapping.json created!")
