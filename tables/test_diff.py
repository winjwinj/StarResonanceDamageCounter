import json

# Paths to your JSON files
json1_path = "json1.json"
json2_path = "json2.json"
output_path = "result.json"

# Load the JSON files
with open(json1_path, "r", encoding="utf-8") as f:
    data1 = json.load(f)

with open(json2_path, "r", encoding="utf-8") as f:
    data2 = json.load(f)

# Subtract keys: keep only keys in data1 that are not in data2
result = {k: v for k, v in data1.items() if k not in data2}

# Save the result
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=False, indent=4)

print(f"Result saved to {output_path}")
