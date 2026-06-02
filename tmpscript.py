import re

with open('backmarket.html', 'r', encoding='utf-8', errors='ignore') as f:
    html = f.read()

# Look for data-qa attributes used in BM
dqa = re.findall(r'data-qa=[\"\']([\w-]+)[\"\']([\s\S]{0,300})', html)
seen = set()
for name, ctx in dqa:
    if name not in seen:
        seen.add(name)
        print(f'data-qa="{name}":', ctx[:200])
        print()
