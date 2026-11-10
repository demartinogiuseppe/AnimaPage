# usage: oga.py search <type 12|13> <keywords...>   |  oga.py page <slug>
import sys, re, urllib.request, urllib.parse, html
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"
def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
if sys.argv[1] == "search":
    t = sys.argv[2]; keys = " ".join(sys.argv[3:])
    q = urllib.parse.urlencode({"keys": keys, "field_art_type_tid[]": t, "field_art_licenses_tid[]": "4", "sort_by": "count", "sort_order": "DESC"})
    s = get("https://opengameart.org/art-search-advanced?" + q)
    seen = []
    for m in re.finditer(r'<a href="/content/([a-z0-9-]+)">([^<]+)</a>', s):
        if m.group(1) not in seen and m.group(1) not in ("faq",) and "challenge" not in m.group(1):
            seen.append(m.group(1)); print(m.group(1), "|", html.unescape(m.group(2)))
else:
    slug = sys.argv[2]
    s = get("https://opengameart.org/content/" + slug)
    a = re.search(r'Author:.*?<a href="/users/([^"]+)"', s, re.S)
    lic = re.findall(r"license-name'>([^<]+)<", s)
    print("author:", a.group(1) if a else "?", "| license:", sorted(set(lic)))
    for f in sorted(set(re.findall(r'href="(https://opengameart.org/sites/default/files/[^"]+)"', s))):
        if "/css/" in f: continue
        print(" ", f)
