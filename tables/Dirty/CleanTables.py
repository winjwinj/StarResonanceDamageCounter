import json
import os

OUTPUT_FOLDER = os.path.join("..", "Clean")

def clean_buff_table(input_path):
    base, ext = os.path.splitext(input_path)
    output_path = os.path.join(OUTPUT_FOLDER, f"{base}_Clean{ext}")
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cleaned_data = {}
    for key, value in data.items():
        cleaned_entry = {}

        if value.get("NameDesign"):
            cleaned_entry["ChineseShort"] = value["NameDesign"]
        if value.get("Name$english"):
            cleaned_entry["EnglishShort"] = value["Name$english"]
        if value.get("Desc$english"):
            cleaned_entry["EnglishLong"] = value["Desc$english"]

        cleaned_data[key] = cleaned_entry

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(cleaned_data, f, ensure_ascii=False, indent=4)

    print(f"✅ Cleaned {input_path} saved to {output_path}")


def clean_recount_table(input_path):
    base, ext = os.path.splitext(input_path)
    output_path = os.path.join(OUTPUT_FOLDER, f"{base}_Clean{ext}")
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cleaned_data = {}
    for key, value in data.items():
        cleaned_entry = {}
        if value.get("RecountName$english"):
            cleaned_entry["EnglishShort"] = value["RecountName$english"]

        cleaned_data[key] = cleaned_entry

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(cleaned_data, f, ensure_ascii=False, indent=4)

    print(f"✅ Cleaned {input_path} saved to {output_path}")


def clean_chinese_skill_names(input_path):
    base, ext = os.path.splitext(input_path)
    output_path = os.path.join(OUTPUT_FOLDER, f"{base}_Clean{ext}")
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cleaned_data = {key: {"ChineseShort": value} for key, value in data.items() if value}

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(cleaned_data, f, ensure_ascii=False, indent=4)

    print(f"✅ Cleaned {input_path} saved to {output_path}")

def clean_english_skill_names(input_path):
    base, ext = os.path.splitext(input_path)
    output_path = os.path.join(OUTPUT_FOLDER, f"{base}_Clean{ext}")
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cleaned_data = {key: {"EnglishShort": value} for key, value in data.items() if value}

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(cleaned_data, f, ensure_ascii=False, indent=4)

    print(f"✅ Cleaned {input_path} saved to {output_path}")

def clean_talent_table(input_path):
    base, ext = os.path.splitext(input_path)
    output_path = os.path.join(OUTPUT_FOLDER, f"{base}_Clean{ext}")
    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    cleaned_data = {}
    for key, value in data.items():
        cleaned_entry = {}

        if value.get("Des"):
            cleaned_entry["ChineseShort"] = value["Des"]
        if value.get("TalentName$english"):
            cleaned_entry["EnglishShort"] = value["TalentName$english"]
        if value.get("TalentDes$english"):
            cleaned_entry["EnglishLong"] = value["TalentDes$english"]

        cleaned_data[key] = cleaned_entry

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(cleaned_data, f, ensure_ascii=False, indent=4)

    print(f"✅ Cleaned {input_path} saved to {output_path}")


if __name__ == "__main__":
    # BuffTable
    clean_buff_table("BuffTable.json", )

    # RecountTable
    clean_recount_table("RecountTable.json")

    # Chinese Skill Names
    clean_chinese_skill_names("skill_names.json")

    # Manual English Skill Names
    clean_english_skill_names("skill_names_manual.json")

    # SkillTable
    clean_buff_table("SkillTable.json")

    # TalentTable
    clean_talent_table("TalentTable.json")