import json
import os

CLEAN_DIR = "../Clean"
OUTPUT_FILE = "1_Combined.json"
CONFLICT_FILE = "2_Conflicts.json"
def values_conflict(existing, new):
    """Check if two dicts have conflicting non-null values."""
    for k, v in new.items():
        if v is not None and k in existing and existing[k] is not None:
            if existing[k] != v:
                return True
    return False

def merge_values(existing, new):
    """Merge values, preferring non-null if one side is null."""
    for k, v in new.items():
        if existing.get(k) is None and v is not None:
            existing[k] = v
    return existing

def sort_dict_numerically(d):
    """Sort a dict with stringified numeric keys into numeric order."""
    return {k: d[k] for k in sorted(d.keys(), key=lambda x: int(x))}

def main():
    combined = {}
    combined_sources = {}  # Track which file provided each key
    conflicts = {}

    for filename in os.listdir(CLEAN_DIR):
        if filename.endswith("_Clean.json"):
            filepath = os.path.join(CLEAN_DIR, filename)
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)

            for key, value in data.items():
                if key not in combined:
                    combined[key] = value
                    combined_sources[key] = filename
                else:
                    if values_conflict(combined[key], value):
                        if key not in conflicts:
                            conflicts[key] = {}
                            # Include the original source file instead of "existing"
                            conflicts[key][combined_sources[key]] = combined[key]
                        conflicts[key][filename] = value
                    else:
                        combined[key] = merge_values(combined[key], value)

    # Sort before writing
    combined_sorted = sort_dict_numerically(combined)
    conflicts_sorted = sort_dict_numerically(conflicts)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(combined_sorted, f, indent=4, ensure_ascii=False)

    with open(CONFLICT_FILE, "w", encoding="utf-8") as f:
        json.dump(conflicts_sorted, f, indent=4, ensure_ascii=False)

    print(f"✅ Combined written to {OUTPUT_FILE}")
    print(f"⚠️ Conflicts written to {CONFLICT_FILE}")

if __name__ == "__main__":
    main()