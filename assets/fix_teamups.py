import json
import os

def name_to_slug(name):
    return name.lower().replace('&', '').replace(' ', '-')

def fix_teamups(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    fixed_data = []
    for entry in data:
        if 'team' in entry:
            fixed_team = [name_to_slug(hero) for hero in entry['team']]
            entry['team'] = fixed_team
        fixed_data.append(entry)

    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(fixed_data, f, indent=2)

    print(f"✅ Fixed teamups at {file_path}")

def main():
    base_path = 'assets/teamups.json'
    if os.path.exists(base_path):
        fix_teamups(base_path)
    else:
        print("❌ teamups.json not found. Make sure it's in the assets/ folder.")

if __name__ == "__main__":
    main()
