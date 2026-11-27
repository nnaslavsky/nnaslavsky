"""Create web-sized images + data/works.json from data/works.csv.

works.csv columns: id (stable, never reuse), category (slug), old_order, title, occasion,
file (path to the master image, relative to the 'Website Rebuild' folder), is_new,
price_hint, source_on_laptop, origin, note.
exclude (non-empty reason = leave off the site), ...
Optional data/angles.json: {"<id>": [image paths, absolute or relative to 'Website Rebuild']} extra viewing angles.
Optional data/crops.json: {"<id>": [left, top, right, bottom] as fractions} applied before resizing.
"""
import csv, json, os, re, unicodedata
from PIL import Image, ImageOps
import pillow_heif; pillow_heif.register_heif_opener()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REBUILD = os.path.dirname(ROOT)                      # .../Website Rebuild
OUT = os.path.join(ROOT, 'assets', 'img')
SIZES = {'full': 1600, 'thumb': 720}
# Display order of the gallery categories
CATS = [('hobbies', 'Hobbies'), ('professions', 'Professions'), ('music', 'Music'), ('gardening', 'Gardening'),
        ('couples', 'Couples'), ('judaica', 'Judaica & Decor'),
        ('milestones', 'Milestones & Special Occasions'), ('animals', 'Animals & Photo Holders'),
        ('displays', 'Galleries & Displays')]
NO_ARRANGE = {'displays'}   # shown on the site, but left out of the arrangement tool


def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def stamp(src, crop):
    st = os.stat(src)
    return f'{src}|{st.st_mtime}|{st.st_size}|{crop}'


def save(src, name, crop, cache):
    key = stamp(src, crop)
    res, im = {}, None
    for kind, px in SIZES.items():
        dst = os.path.join(OUT, kind, name + '.jpg'); os.makedirs(os.path.dirname(dst), exist_ok=True)
        if cache.get(name) != key or not os.path.exists(dst):
            if im is None:
                im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
                if crop:
                    w, h = im.size; im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
            c = im.copy(); c.thumbnail((px, px), Image.LANCZOS)
            c.save(dst, quality=82 if kind == 'full' else 78, optimize=True, progressive=True)
        with Image.open(dst) as d: res[kind] = [d.width, d.height]
    cache[name] = key
    return res


def save_angle(src, name, cache):
    """Extra viewing angle: a 1600px image plus a small 200px strip thumbnail ('-t')."""
    key = stamp(src, None)
    d = os.path.join(OUT, 'angles'); os.makedirs(d, exist_ok=True)
    full, small = os.path.join(d, name + '.jpg'), os.path.join(d, name + '-t.jpg')
    if cache.get(name) != key or not (os.path.exists(full) and os.path.exists(small)):
        im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
        a = im.copy(); a.thumbnail((1600, 1600), Image.LANCZOS); a.save(full, quality=82, optimize=True, progressive=True)
        b = im.copy(); b.thumbnail((200, 200), Image.LANCZOS); b.save(small, quality=76, optimize=True)
    cache[name] = key
    with Image.open(full) as f: return [f.width, f.height]


def main():
    rows = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'works.csv'))))
    crops_f = os.path.join(ROOT, 'data', 'crops.json')
    crops = json.load(open(crops_f)) if os.path.exists(crops_f) else {}
    cache_f = os.path.join(OUT, '.cache.json')
    cache = json.load(open(cache_f)) if os.path.exists(cache_f) else {}
    valid = {s for s, _ in CATS}
    ang_f = os.path.join(ROOT, 'data', 'angles.json')
    angles = json.load(open(ang_f)) if os.path.exists(ang_f) else {}
    used, works, used_angles = set(), [], set()
    for r in rows:
        if r.get('exclude'): continue           # kept in the catalog for reference, not on the site
        assert r['category'] in valid, (r['id'], r['category'])
        slug = base = slugify(r['title']) or r['id']; k = 2
        while slug in used: slug = f'{base}-{k}'; k += 1
        used.add(slug)
        dims = save(os.path.join(REBUILD, r['file']), slug, crops.get(r['id']), cache)
        extra = []
        for k, p in enumerate(angles.get(r['id'], []), 1):
            name = f'{slug}--{k}'
            dims_a = save_angle(p if os.path.isabs(p) else os.path.join(REBUILD, p), name, cache)
            used_angles.add(name); extra.append(dims_a)
        works.append(dict(angles=extra, id=r['id'], slug=slug, title=r['title'], category=r['category'], order=int(r['old_order'] or 999),
                          occasion=r['occasion'], isNew=bool(r['is_new']), commissioned=bool(r.get('commissioned')), w=dims['full'][0], h=dims['full'][1]))
    # remove images that no longer belong to any work
    for kind in SIZES:
        for f in os.listdir(os.path.join(OUT, kind)):
            if f[:-4] not in used: os.remove(os.path.join(OUT, kind, f)); cache.pop(f[:-4], None)
    adir = os.path.join(OUT, 'angles')
    if os.path.isdir(adir):
        for f in os.listdir(adir):
            if f.endswith('.jpg') and f[:-4].removesuffix('-t') not in used_angles: os.remove(os.path.join(adir, f))
    json.dump(cache, open(cache_f, 'w'))
    cats = [dict(slug=s, name=n, count=sum(1 for w in works if w['category'] == s), arrange=s not in NO_ARRANGE) for s, n in CATS]
    json.dump(dict(categories=cats, works=works), open(os.path.join(ROOT, 'data', 'works.json'), 'w'), indent=1)
    print(len(works), 'works;', ', '.join(f"{c['slug']} {c['count']}" for c in cats))


if __name__ == '__main__':
    main()
