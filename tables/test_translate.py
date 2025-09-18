import \
    json
import \
    os

from deep_translator import GoogleTranslator

# Create translator instance
translator = GoogleTranslator(source='zh-CN', target='en')

if os.path.exists("skill_names.json"):
    with open("skill_names.json", "r", encoding="utf-8") as f:
        skill_names = json.load(f)["skill_names"]

# Function to append full translations
def append_full_translation(name: str) -> str:
    # Detect if the string contains Chinese characters
    if any('\u4e00' <= ch <= '\u9fff' for ch in name):
        try:
            translated = translator.translate(name)
            print(f"translated {name} {translated}")
            return f"{name} {translated}"
        except Exception:
            return name
    return name

# Apply translation to all skill names
translated_skills_full = {k: append_full_translation(v) for k, v in skill_names.items()}

# Save fully translated version
output_full_path = "skill_names_aitranslated.json"
with open(output_full_path, "w", encoding="utf-8") as f:
    json.dump({"skill_names": translated_skills_full}, f, ensure_ascii=False, indent=4)
