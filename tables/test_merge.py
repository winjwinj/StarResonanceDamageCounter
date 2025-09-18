import json
import os
import \
    re

# file paths
skill_table_file = "SkillTable.json"
skill_table_base_file = "SkillTableBase.json"
skill_names_file = "skill_names.json"
skill_names_translated_file = "skill_names_translated.json"
buff_table_file = "BuffTableBase.json"
buff_table_ai_file = "BuffTableBase_aitranslated.json"
skill_names_ai_file = "skill_names_aitranslated.json"


merged = {}

# 0. SkillTable.json → Name$English (highest priority)
if os.path.exists(skill_table_file):
    with open(skill_table_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        for k, v in data.items():
            if isinstance(v, dict):
                name = v.get("Name$english")
                if isinstance(name, str) and name.strip():
                    merged[int(k)] = name

# 1. skill_names_translated.json → skill_names
if os.path.exists(skill_names_translated_file):
    with open(skill_names_translated_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        if "skill_names" in data and isinstance(data["skill_names"], dict):
            for k, v in data["skill_names"].items():
                if isinstance(v, str) and v.strip():
                    if int(k) not in merged:
                        merged[int(k)] = v

# 2. SkillTableBase.json → Name (highest priority)
if os.path.exists(skill_table_base_file):
    with open(skill_table_base_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        for k, v in data.items():
            if isinstance(v, dict):
                name = v.get("Name")
                if isinstance(name, str) and name.strip():
                    merged[int(k)] = name


# 3. BuffTableBase_aitranslated.json → Name
# 4. BuffTableBase_aitranslated.json → NameDesign
if os.path.exists(buff_table_file):
    with open(buff_table_file, "r", encoding="utf-8-sig") as f:
        data = json.load(f)
        for k, v in data.items():
            if not isinstance(v, dict):
                continue
            # Name first
            name = v.get("Name")
            if isinstance(name, str) and name.strip():
                if int(k) not in merged:
                    merged[int(k)] = name
            # NameDesign next
            name_design = v.get("NameDesign")
            if isinstance(name_design, str) and name_design.strip():
                if int(k) not in merged:
                    merged[int(k)] = name_design

# 5. SkillTableBase.json → NameDesign (lowest priority)
if os.path.exists(skill_table_base_file):
    with open(skill_table_base_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        for k, v in data.items():
            if isinstance(v, dict):
                name_design = v.get("NameDesign")
                if isinstance(name_design, str) and name_design.strip():
                    if int(k) not in merged:
                        merged[int(k)] = name_design

# 1. skill_names_translated.json → skill_names
if os.path.exists(skill_names_file):
    with open(skill_names_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        if "skill_names" in data and isinstance(data["skill_names"], dict):
            for k, v in data["skill_names"].items():
                if isinstance(v, str) and v.strip():
                    if int(k) not in merged:
                        merged[int(k)] = v

def contains_chinese(text):
    return bool(re.search(r'[\u4e00-\u9fff]', str(text)))

if os.path.exists(skill_names_ai_file):
    with open(skill_names_ai_file, "r", encoding="utf-8-sig") as f1:
        if os.path.exists(buff_table_ai_file):
            with open(buff_table_ai_file, "r", encoding="utf-8-sig") as f2:
                skill_json = json.load(f1).get("skill_names", 0)
                buff_json = json.load(f2)
                for skill_id, skill_name_original in list(merged.items()):
                    if contains_chinese(skill_name_original):
                        _skill_id = str(skill_id)
                        skill_name = skill_json.get(_skill_id, False)
                        buff_name = buff_json.get(_skill_id, {}).get("NameDesign", False)
                        if buff_name: print(buff_name)
                        english_ai_skill_name = skill_name if skill_name else (buff_name if buff_name else False)
                        if english_ai_skill_name:
                            merged[skill_id] += f"<br>(AI: {english_ai_skill_name})"

# print(merged)
# sort numerically
merged_sorted = dict(sorted(merged.items()))

# save output
with open(
        "final_merged.json", "w", encoding="utf-8") as f:
    json.dump(merged_sorted, f, indent=2, ensure_ascii=False)

print(f"Merged {len(merged_sorted)} entries into final_merged.json")
