"""Build the website (design A, "Paper & Ink") into the repo root from data/works.json + data/arrangement.json.

All three share the same content and pages; they differ in templates for the
home page and in their stylesheet. Run:  python tools/build_mockups.py
"""
import html, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = json.load(open(os.path.join(ROOT, 'data', 'works.json')))
WORKS = DATA['works']
BY_SLUG = {w['slug']: w for w in WORKS}
CATS = DATA['categories']
CATNAME = {c['slug']: c['name'] for c in CATS}
IMG = 'assets/img/'
e = html.escape
import glob as _g
VER = str(int(max(os.path.getmtime(f) for f in _g.glob(os.path.join(ROOT, 'css', '*.css')) + _g.glob(os.path.join(ROOT, 'js', '*.js')) + _g.glob(os.path.join(ROOT, 'assets', 'img', 'site', '*.jpg')))))  # cache-buster for css/js

THEMES = {
    'a': dict(name='Paper & Ink', blurb='Warm and cozy: cream paper, handwritten touches, sculptures shown like snapshots pinned to a studio wall.',
              fonts='family=Caveat:wght@500;700&family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=Nunito+Sans:wght@400;600;700'),
    'b': dict(name='Gallery', blurb='Calm and professional: lots of white space, elegant type, every sculpture on an even grid like a gallery catalog.',
              fonts='family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600'),
    'c': dict(name='Playful Studio', blurb='Bright and joyful: colors pulled from her sculptures, rounded shapes, bouncy type — as fun as the art itself.',
              fonts='family=Baloo+2:wght@600;700;800&family=Nunito:wght@400;600;700'),
}

NAV = [('index.html', 'Home'), ('gallery.html', 'Gallery'), ('process.html', 'How I Make Them'),
       ('commissions.html', 'Commissions'), ('about.html', 'About'), ('contact.html', 'Contact')]

CAT_BLURB = {
    'milestones': 'Birthdays, graduations, weddings and retirements — personal sculptures for life’s big moments.',
    'hobbies': 'Bookworms, hikers, shoppers, yogis and donut lovers — people doing what they love most.',
    'professions': 'Doctors, teachers, lawyers, scientists and more — every trade, with a wink.',
    'music': 'Pianists, cellists, trumpeters and divas, caught mid-performance.',
    'gardening': 'Gardeners, cactus ladies and backyard farmers among their flowers.',
    'couples': 'Love stories side by side — on benches, bikes, sofas and even a tree.',
    'judaica': 'Rabbis, Shabbat tables, mezuzot, hamsas and wall pieces with a Jewish sense of humor.',
    'commissions': 'Personalized sculptures made to order for clients and their loved ones.',
}
CAT_BLURB.update({
    'animals': 'Birds, owls, cats, dogs and cheerful photo holders — small critters with big personalities.',
    'in-progress': 'A peek behind the scenes: sculptures on their way to being finished.',
    'displays': 'My work out in the world — at galleries, shows and art fairs.',
})

# ---- Naava's arrangement (written by the arrangement tool, data/arrangement.json) ----
BY_ID = {w['id']: w for w in WORKS}
_arr_f = os.path.join(ROOT, 'data', 'arrangement.json')
ARR = json.load(open(_arr_f)) if os.path.exists(_arr_f) else {}
CATS = [c for c in CATS if c['count']]                     # hide empty categories
def _ids_to_slugs(ids): return [BY_ID[i]['slug'] for i in ids if i in BY_ID]
HERO = _ids_to_slugs(ARR.get('hero', []))
FEATURED = _ids_to_slugs(ARR.get('featured', []))
_first = {}
for w in sorted(WORKS, key=lambda w: (w['order'], w['id'])): _first.setdefault(w['category'], w['slug'])
CAT_COVER = {c['slug']: (BY_ID[ARR['covers'][c['slug']]]['slug'] if ARR.get('covers', {}).get(c['slug']) in BY_ID else _first[c['slug']]) for c in CATS}
if len(HERO) < 3: HERO = (HERO + [s for s in ['grand-pianist', 'yoga', 'molecular-biologist'] if s in BY_SLUG and s not in HERO])[:3]
if not FEATURED: FEATURED = [CAT_COVER[c['slug']] for c in CATS]


def ordered(cat):
    """Pinned works first (in Naava's order), then everything else in default order."""
    pinned = [i for i in ARR.get('order', {}).get(cat, []) if i in BY_ID and BY_ID[i]['category'] == cat]
    rest = sorted([w for w in WORKS if w['category'] == cat and w['id'] not in pinned], key=lambda w: (w['order'], w['id']))
    return [BY_ID[i] for i in pinned] + rest

GALLERIES = [('Galleria Greendale', 'Greendale, WI', 'http://galleriagreendale.com/'),
             ('Artisans in the Loop', 'St. Louis, MO', 'https://artisansintheloop.square.site/s/search?q=naava%20naslavsky'),
             ('Bluestem Missouri Crafts', 'Columbia, MO', 'https://bluestemcrafts.com/'),
             ('Artisans Collective STL', 'St. Louis, MO', 'https://artisanscollectivestl.square.site/s/search?q=naava')]
# Contact form delivery: Web3Forms (free). The access key is meant to be public; it maps to the inbox chosen in the Web3Forms dashboard.
WEB3FORMS_KEY = 'a1ea18c9-3344-43c1-9a23-99677e590eea'
EMAIL, PHONE, PHONE_TEL = 'nnaslavsky@unmc.edu', '402-650-3874', '+14026503874'
INSTAGRAM, FACEBOOK = 'https://www.instagram.com/naavanaslavsky/', 'https://www.facebook.com/naava.naslavsky/'

BIO = [
    'My name is Naava Naslavsky, and I have two concomitant passions that together make me whole and happy: science &amp; art. '
    'In my “real life” I am a scientist, a cell biologist, conducting biomedical research at the University of Nebraska Medical Center in Omaha, NE.',
    'I work with paper mâché out of my humble ‘home-studio’, a former dining room which I have transformed into my small creativity-domain. '
    'My sculptures are ALL funny, whimsical and full of humor. I love the combination of humor and art — they make such a nice ‘duo’ that brings a smile to almost everyone!',
    'In the process of making my paper-mâché sculptures, I recycle materials and objects, re-purposing them into new shapes that completely differ from their original look and use. '
    'For example, the pipettes that I routinely use in the lab are transformed into the long legs of some of my whimsical sculptures, and the scientific articles (‘papers’) that I read and write are shredded and become my raw material.',
    'Paper-mâché is the “master acrobat” when it comes to versatility of media: it is free and wild, and on top of that — can acquire vibrant colors… so isn’t it THE classical media to create humorous sculptures?',
]
FACTS = [('Born &amp; raised', 'on a kibbutz in northern Israel'), ('Creating since', '2010, in paper mâché'),
         ('Award', '2012 People’s Choice Best Artist, Art &amp; Soup, Omaha'), ('Day job', 'Cell biologist, University of Nebraska Medical Center')]
PAST_GALLERIES = 'Blue Pomegranate (Omaha, NE) · Sweetheart Gallery (Woodstock, NY) · Pennello (Cleveland, OH) · From Our Hands (Des Moines, IA) · The Blue Door (Springfield, IL) · Morning Glory (Milwaukee, WI)'

# Steps 2-5 use Naava's own text ("How I make them.docx", Nov 2026). Each step: (title, [images], text)
STEPS = [
    ('From the lab', ['process-lab'], 'My raw material comes from my other life. Printed scientific papers that we read and write in the lab are shredded into pulp, and lab pipettes and other small pieces get a second life as long legs and props.'),
    ('Creating the face', ['process-clay-heads', 'process-face'], 'Every figure begins with a ball of aluminum foil, covered with lightweight clay to shape the head. I then sculpt the facial features, bringing each face to life with its own unique expression. A brief bake in the oven hardens the clay. This is the stage where each character’s personality begins to emerge.'),
    ('Building the body', ['process-unfinished'], 'The clay head is attached to a Styrofoam torso with wire. I then prepare the limbs from wire and attach them to the torso, creating a wire skeleton that gives the figure its pose and structure. The entire framework is then covered with paper mâché pulp, made from shredded paper, water, and a natural, non-toxic cellulose glue.'),
    ('Smoothing the surface', ['process-paper'], 'Once the paper mâché has dried, I cover the sculpture with layers of tissue paper and cellulose glue, creating a smoother, more refined surface.'),
    ('Color and finishing touches', ['process-paint', 'process-no-hair', 'process-with-hair'], 'The sculptures finally come to life through color. I paint them with acrylics, dress them in patterned paper, and finish them with a glossy coating. The very last touch is the hair, made from wool, which completes each character.'),
    ('About three weeks later…', [None], 'One sculpture takes around three weeks to finish. True to their raw material, the finished pieces stay surprisingly light.'),
]
RECYCLE = 'Nothing goes to waste: the paper is recycled, sculptures dry in the sun or with the warmth of the house, and everyday objects are re-purposed — so there is minimal waste in the whole process.'
OCCASIONS = ['Birthday', 'Mother’s &amp; Father’s Day', 'Retirement', 'Anniversary', 'Farewell party', 'Valentine’s Day',
             'New baby', 'Bar / Bat Mitzvah', 'Engagement', 'Wedding', 'Graduation']

ICON = {
    'instagram': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor"/></svg>',
    'facebook': '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14 8.5V6.8c0-.8.5-1 1-1h2V2.5h-2.8C11.1 2.5 10.4 4.7 10.4 6.4v2.1H8v3.4h2.4V21.5H14v-9.6h2.7l.4-3.4z"/></svg>',
    'mail': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    'phone': '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>',
}


MINI = f'<img class="mini-portrait" src="{IMG}site/naava-pfp.jpg?v={VER}" width="72" height="72" style="width:72px;height:72px;border-radius:50%;object-fit:cover" alt="Naava Naslavsky">'


def img(slug, kind='thumb'):
    return f'{IMG}{kind}/{slug}.jpg'


def work_card(w, show_cat=False):
    meta = w['occasion'] or (CATNAME[w['category']] if show_cat else '')
    alt = f'{w["title"]} — paper mâché sculpture' if w['title'] else f'{CATNAME[w["category"]]} — Naava Naslavsky'
    cap = (f'<figcaption><span class="work-title">{e(w["title"])}</span>' + (f'<span class="work-meta">{e(meta)}</span>' if meta else '') + '</figcaption>') if (w['title'] or meta) else ''
    views = ''
    badge = ''
    if w.get('angles'):
        lst = [[img(w['slug'], 'full'), img(w['slug'])]] + [[f'{IMG}angles/{w["slug"]}--{k}.jpg', f'{IMG}angles/{w["slug"]}--{k}-t.jpg'] for k in range(1, len(w['angles']) + 1)]
        views = f' data-views="{e(json.dumps(lst))}"'
        badge = f'<span class="views-badge" aria-label="{len(lst)} views">{len(lst)} views</span>'
    return (f'<figure class="work"><a class="work-link" href="{img(w["slug"], "full")}" data-work data-full="{img(w["slug"], "full")}" '
            f'data-title="{e(w["title"])}" data-meta="{e(meta or CATNAME[w["category"]])}"{views}>'
            f'<img src="{img(w["slug"])}" width="{w["w"]}" height="{w["h"]}" loading="lazy" alt="{e(alt)}">{badge}</a>{cap}</figure>')


def grid(works, show_cat=False):
    return '<div class="works">' + ''.join(work_card(w, show_cat) for w in works) + '</div>'


def social_links():
    return (f'<a class="social" href="{INSTAGRAM}" aria-label="Instagram">{ICON["instagram"]}</a>'
            f'<a class="social" href="{FACEBOOK}" aria-label="Facebook">{ICON["facebook"]}</a>')


def galleries_list():
    return '<ul class="galleries">' + ''.join(f'<li><a href="{u}">{n}</a><span>{p}</span></li>' for n, p, u in GALLERIES) + '</ul>'


def page(t, fname, title, body, active=''):
    th = THEMES[t]
    nav = ''.join(f'<a href="{h}"' + (' aria-current="page"' if h == active else '') + f'>{n}</a>' for h, n in NAV)
    doc = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)} · Naava Naslavsky – Paper Mâché Sculptures</title>
<meta name="description" content="Whimsical, humorous paper mâché sculptures by Omaha artist and scientist Naava Naslavsky. Commissions welcome.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?{th["fonts"]}&display=swap">
<link rel="stylesheet" href="css/base.css?v={VER}"><link rel="stylesheet" href="css/style.css?v={VER}"></head>
<body class="theme-{t}">
<header class="site-header"><div class="wrap header-inner">
<a class="brand" href="index.html"><span class="brand-name">Naava Naslavsky</span><span class="brand-sub">whimsical art in paper mâché</span></a>
<button class="nav-toggle" data-nav-toggle aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span><span class="sr">Menu</span></button>
<nav id="site-nav" class="site-nav" aria-label="Main">{nav}</nav></div></header>
<main>{body}</main>
<footer class="site-footer"><div class="wrap footer-inner">
<div class="footer-col"><p class="footer-brand">Naava Naslavsky</p><p>Humorous &amp; whimsical paper mâché sculptures, made in Omaha, Nebraska.</p><p class="socials">{social_links()}</p></div>
<div class="footer-col"><p class="footer-h">Find my work at</p>{galleries_list()}</div>
<div class="footer-col"><p class="footer-h">Say hello</p><p><a href="mailto:{EMAIL}">{EMAIL}</a><br><a href="tel:{PHONE_TEL}">{PHONE}</a></p><p><a class="btn btn-small" href="commissions.html">Commission a sculpture</a></p></div>
</div><p class="wrap copyright">© 2026 Naava Naslavsky. All sculptures and photographs are the artist’s own.</p></footer>
<script src="js/site.js?v={VER}"></script></body></html>'''
    open(os.path.join(ROOT, fname), 'w').write(doc)


# ---------- shared sections ----------
def section_categories():
    cards = ''.join(f'<a class="cat-card" href="cat-{c["slug"]}.html"><span class="cat-img"><img src="{img(CAT_COVER[c["slug"]])}" alt="" loading="lazy"></span>'
                    f'<span class="cat-name">{c["name"]}</span><span class="cat-count">{c["count"]} pieces</span></a>' for c in CATS)
    return f'<div class="cats">{cards}</div>'


def section_featured():
    return grid([BY_SLUG[s] for s in FEATURED], show_cat=True)


def process_teaser():
    small = [('process-sculpting', 'Sculpted over a wire skeleton'), ('process-face', 'Faces in light-weight clay'), ('process-paint', 'Painted &amp; glazed')]
    figs = ''.join(f'<figure><img src="{IMG}site/{s}.jpg" alt="" loading="lazy"><figcaption>{c}</figcaption></figure>' for s, c in small)
    return figs


def commission_points():
    return ('<ul class="facts-list"><li><b>$110–170</b><span>for a single sculpture, depending on size &amp; complexity</span></li>'
            '<li><b>$210–260</b><span>for two figures</span></li>'
            '<li><b>3–4 weeks</b><span>from our first email-chat to a finished piece</span></li>'
            '<li><b>UPS ground</b><span>carefully packed and shipped to your door</span></li></ul>')


# ---------- home pages (the part that differs most) ----------
def home_a():
    pol = ''.join(f'<a class="polaroid p{i}" href="cat-{BY_SLUG[s]["category"]}.html"><img src="{img(s)}" alt="{e(BY_SLUG[s]["title"])}"><span>{e(BY_SLUG[s]["title"])}</span></a>'
                  for i, s in enumerate(HERO[:4]))
    return f'''
<section class="hero"><div class="wrap hero-inner">
 <div class="hero-text"><p class="hello-row">{MINI}<span class="hand kicker">hello there!</span></p>
  <h1>Whimsical people<br>in paper mâché</h1>
  <p class="lead">Funny, colorful sculptures of people doing what they love — made by scientist-artist Naava Naslavsky from recycled lab papers, in her little Omaha home studio.</p>
  <p class="actions"><a class="btn" href="gallery.html">See the sculptures</a><a class="btn btn-ghost" href="commissions.html">Commission a piece</a></p></div>
 <div class="hero-art">{pol}</div></div></section>
<section class="band"><div class="wrap split">
 <figure class="photo-frame"><img src="{IMG}site/naava-holding-sculptures.jpg" alt="Naava Naslavsky holding two of her sculptures"></figure>
 <div><p class="hand kicker">a scientist by day…</p><h2>Two passions, one happy studio</h2><p>{BIO[0]}</p><p><a class="link" href="about.html">More about me →</a></p></div></div></section>
<section class="wrap section"><div class="section-head"><p class="hand kicker">a few favorites</p><h2>From the studio</h2></div>{section_featured()}
 <p class="center"><a class="btn" href="gallery.html">Browse all {len(WORKS)} sculptures</a></p></section>
<section class="wrap section"><div class="section-head"><p class="hand kicker">find your people</p><h2>Browse by theme</h2></div>{section_categories()}</section>
<section class="band band-kraft"><div class="wrap split split-rev">
 <div><p class="hand kicker">made from recycled science</p><h2>How I make them</h2><p>Shredded lab papers, a wire skeleton, a clay face full of character, then paint and gloss. Every piece takes about three weeks.</p><p><a class="link" href="process.html">See the process →</a></p></div>
 <div class="process-strip">{process_teaser()}</div></div></section>
<section class="wrap section commission-cta"><div class="note-card"><p class="hand kicker">a gift like no other</p><h2>Commission a sculpture</h2>
 <p>Tell me about someone special — their job, hobby, passions, anything — and I’ll turn them into a one-of-a-kind whimsical sculpture. I also take special orders from galleries.</p>
 {commission_points()}<p><a class="btn" href="contact.html?topic=Commission">Start a commission</a></p></div></section>'''


def home_b():
    return f'''
<section class="hero"><div class="wrap hero-grid">
 <div class="hero-text"><p class="hello-row">{MINI}<span class="eyebrow">Paper mâché sculpture · Omaha, Nebraska</span></p><h1>Humorous &amp; whimsical sculptures by Naava Naslavsky</h1>
  <p class="lead">One-of-a-kind characters made from recycled scientific papers — shown in galleries across the Midwest and made to order for clients.</p>
  <p class="actions"><a class="btn" href="gallery.html">View the collection</a><a class="btn btn-ghost" href="commissions.html">Commissions</a></p></div>
 <figure class="hero-figure"><img src="{img(HERO[0], 'full')}" alt="{e(BY_SLUG[HERO[0]]['title'])} — paper mâché sculpture"><figcaption>{e(BY_SLUG[HERO[0]]['title'])}</figcaption></figure></div>
 <div class="wrap hero-more">{''.join(f'<a href="cat-{BY_SLUG[s]["category"]}.html"><img src="{img(s)}" alt="{e(BY_SLUG[s]["title"])}"><span>{e(BY_SLUG[s]["title"])}</span></a>' for s in HERO[1:4])}</div></section>
<section class="wrap section"><div class="section-head row"><h2>Selected works</h2><a class="link" href="gallery.html">All works →</a></div>{section_featured()}</section>
<section class="wrap section"><div class="section-head row"><h2>Collections</h2></div>{section_categories()}</section>
<section class="section tint"><div class="wrap split">
 <figure><img src="{IMG}site/naava-holding-sculptures.jpg" alt="Naava Naslavsky with two of her sculptures"></figure>
 <div><p class="eyebrow">The artist</p><h2>A cell biologist with a sense of humor</h2><p>{BIO[0]}</p><p>{BIO[2]}</p><p><a class="link" href="about.html">About Naava →</a></p></div></div></section>
<section class="wrap section split split-rev">
 <div><p class="eyebrow">Commissions</p><h2>A personalized sculpture for someone unique</h2><p>Single characters, couples or whole families — shaped around a profession, hobby or passion you describe. Galleries are welcome to place special orders.</p>{commission_points()}<p><a class="btn" href="contact.html?topic=Commission">Enquire about a commission</a></p></div>
 <div class="process-strip">{process_teaser()}</div></section>
<section class="wrap section"><div class="section-head row"><h2>Represented by</h2></div>{galleries_list()}</section>'''


def home_c():
    blobs = ''.join(f'<a class="blob b{i}" href="cat-{BY_SLUG[s]["category"]}.html"><img src="{img(s)}" alt="{e(BY_SLUG[s]["title"])}"></a>'
                    for i, s in enumerate(HERO[:4]))
    chips = ''.join(f'<a class="chip chip-{i % 4}" href="cat-{c["slug"]}.html">{c["name"]}</a>' for i, c in enumerate(CATS))
    steps = ''.join(f'<li><span class="num">{i + 1}</span><b>{t}</b></li>' for i, (t, _, _) in enumerate(STEPS[:5]))
    return f'''
<section class="hero"><div class="wrap hero-grid">
 <div class="hero-text"><p class="hello-row">{MINI}<span class="sticker">Hi! I’m Naava 👋</span></p><h1>Funny little people, made from <span class="hl">science papers</span>.</h1>
  <p class="lead">I’m a cell biologist who turns shredded lab papers into whimsical paper mâché sculptures — doctors, bookworms, pianists, gardeners, and maybe you.</p>
  <p class="actions"><a class="btn" href="gallery.html">Meet the characters</a><a class="btn btn-ghost" href="commissions.html">Order your own</a></p>
  <p class="chips">{chips}</p></div>
 <div class="hero-art">{blobs}</div></div>
 <svg class="wave" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0,40 C240,90 480,0 720,40 C960,80 1200,10 1440,40 L1440,80 L0,80 Z"/></svg></section>
<section class="section color-band"><div class="wrap"><div class="section-head"><h2>Fan favorites</h2><p>Click any sculpture to see it up close.</p></div>{section_featured()}
 <p class="center"><a class="btn" href="gallery.html">See all {len(WORKS)} sculptures</a></p></div></section>
<section class="wrap section"><div class="section-head"><h2>Pick a theme</h2></div>{section_categories()}</section>
<section class="wrap section split">
 <div class="speech"><h2>From lab bench to living room</h2><ol class="steps">{steps}</ol><p><a class="btn btn-ghost" href="process.html">See how it’s made</a></p></div>
 <figure class="photo-pop"><img src="{IMG}site/naava-holding-sculptures.jpg" alt="Naava Naslavsky holding two of her sculptures"></figure></section>
<section class="section cta-pink"><div class="wrap cta-inner"><div><h2>Want one of your own?</h2><p>Send me photos, hobbies, inside jokes — whatever you like — and I’ll sculpt a one-of-a-kind character for a birthday, retirement, wedding or just because.</p></div>
 <div>{commission_points()}<p><a class="btn btn-light" href="contact.html?topic=Commission">Start a commission</a></p></div></div></section>'''


# ---------- other pages (shared markup, themed by CSS) ----------
def gallery_page():
    return (f'<section class="page-head wrap"><h1>Gallery</h1><p class="lead">{len(WORKS)} whimsical sculptures in {len(CATS)} collections. Pick a theme, then click any piece to see it up close.</p></section>'
            f'<section class="wrap section">{section_categories()}</section>')


def cat_page(c):
    works = ordered(c['slug'])
    tabs = ''.join(f'<a href="cat-{x["slug"]}.html"' + (' aria-current="page"' if x['slug'] == c['slug'] else '') + f'>{x["name"]}</a>' for x in CATS)
    return (f'<section class="page-head wrap"><p class="crumbs"><a href="gallery.html">Gallery</a> / {c["name"]}</p><h1>{c["name"]}</h1><p class="lead">{CAT_BLURB[c["slug"]]}</p>'
            f'<nav class="cat-tabs" aria-label="Collections">{tabs}</nav></section><section class="wrap section">{grid(works)}</section>'
            f'<section class="wrap section small-cta"><p>Love one of these? Most pieces are one-of-a-kind, but I’m happy to create something similar just for you.</p><a class="btn" href="contact.html?topic=Commission">Ask about a commission</a></section>')


def process_page():
    out = []
    for i, (t, imgs, txt) in enumerate(STEPS):
        srcs = [f'{IMG}site/{s}.jpg' if s else img(HERO[0], 'full') for s in imgs]
        figs = ''.join(f'<img src="{src}" alt="" loading="lazy">' for src in srcs)
        out.append(f'<li class="step"><figure class="step-imgs n{len(srcs)}">{figs}</figure><div><span class="step-num">Step {i + 1}</span><h2>{t}</h2><p>{txt}</p></div></li>')
    return (f'<section class="page-head wrap"><h1>How I make them</h1><p class="lead">From the lab bench to the art studio: every sculpture is built by hand from papier mâché made of recycled scientific papers, wire, clay and lots of color.</p></section>'
            f'<section class="wrap section"><ol class="process">{"".join(out)}</ol></section>'
            f'<section class="wrap section"><div class="note-card recycle"><h2>Recycling at heart</h2><p>{RECYCLE}</p></div></section>')


def commissions_page():
    occ = ''.join(f'<li>{o}</li>' for o in OCCASIONS)
    samples, seen = [], set()
    for w in sorted([w for w in WORKS if w.get('commissioned') or w['category'] == 'milestones'], key=lambda w: (not w.get('commissioned'), w['order'])):
        if w['title'] not in seen: seen.add(w['title']); samples.append(w)
    return (f'<section class="page-head wrap"><h1>Commission a sculpture</h1><p class="lead">Give a personalized gift to someone unique.</p></section>'
            f'<section class="wrap section split commission-split"><div><p>I am more than happy to design highly personalized sculptures of family, friends and loved ones. I can sculpt whimsical characters with features and characteristics that <em>you</em> provide — a single character, a couple, or a group such as family members.</p>'
            f'<p>My sculptures can easily take into account profession, job or trade, hobbies, likes and passions. I <em>enjoy</em> incorporating these characteristics and making individualized sculptures!</p>'
            f'<h2>Perfect for</h2><ul class="occasions">{occ}</ul></div>'
            f'<div class="note-card"><h2>How it works</h2><ol class="how"><li><b>Tell me about them.</b> Their hobbies, profession, favorite colors or outfits, inside jokes, meaningful moments. You’re welcome to send photos, too. Since the sculpture’s head is quite small, only the main facial features can be captured — but this is where your personal input can really bring the character to life.</li><li><b>I sculpt.</b> Please allow 3–4 weeks.</li><li><b>It arrives.</b> Delivered via UPS ground.</li></ol>'
            f'{commission_points()}<p>Once the details of the commissioned piece are finalized, I send you a price quote for approval. Once approved, I begin creating the sculpture.</p><p>I also take special orders from art galleries.</p><p><a class="btn" href="contact.html?topic=Commission">Start a commission</a></p></div></section>'
            f'<section class="wrap section"><div class="section-head"><h2>Commissioned &amp; special-occasion pieces</h2></div>{grid(samples)}</section>')


def about_page():
    facts = ''.join(f'<li><b>{a}</b><span>{b}</span></li>' for a, b in FACTS)
    return (f'<section class="page-head wrap"><h1>About Naava</h1></section>'
            f'<section class="wrap section split about-split"><figure class="photo-frame"><img src="{IMG}site/naava-holding-sculptures.jpg" alt="Naava Naslavsky holding two of her paper mâché sculptures"></figure>'
            f'<div>{"".join(f"<p>{p}</p>" for p in BIO)}</div></section>'
            f'<section class="wrap section"><ul class="facts-list facts-4">{facts}</ul></section>'
            f'<section class="wrap section"><figure class="about-wide"><img src="{IMG}site/naava-gallery.jpg" alt="Naava Naslavsky with her sculptures at a gallery" loading="lazy"></figure></section>'
            f'<section class="wrap section split"><div><h2>Where to find my work</h2>{galleries_list()}</div>'
            f'<div><h2>Previously shown at</h2><p>{PAST_GALLERIES}</p><p><a class="btn" href="contact.html">Get in touch</a></p></div></section>')


def contact_page():
    return (f'<section class="page-head wrap"><h1>Get in touch</h1><p class="lead">Questions, commissions, gallery enquiries — or just to say hello.</p></section>'
            f'<section class="wrap section split contact-split"><div>'
            f'<ul class="contact-list"><li>{ICON["mail"]}<a href="mailto:{EMAIL}">{EMAIL}</a></li><li>{ICON["phone"]}<a href="tel:{PHONE_TEL}">{PHONE}</a></li>'
            f'<li>{ICON["instagram"]}<a href="{INSTAGRAM}">@naavanaslavsky</a></li><li>{ICON["facebook"]}<a href="{FACEBOOK}">Facebook</a></li></ul>'
            f'<h2>Galleries</h2>{galleries_list()}</div>'
            f'<form class="contact-form note-card" data-endpoint="https://api.web3forms.com/submit">'
            f'<input type="hidden" name="access_key" value="{WEB3FORMS_KEY}">'
            f'<input type="hidden" name="subject" value="New message from naavanaslavsky.com"><input type="hidden" name="from_name" value="naavanaslavsky.com">'
            f'<input type="checkbox" name="botcheck" tabindex="-1" autocomplete="off" aria-hidden="true" class="sr">'
            f'<label>Your name<input name="name" required autocomplete="name"></label>'
            f'<label>Email<input name="email" type="email" required autocomplete="email"></label>'
            f'<label>Phone <small>(optional)</small><input name="phone" type="tel" autocomplete="tel"></label>'
            f'<label>What is this about?<select name="topic"><option>Commission</option><option>Gallery enquiry</option><option>Question about a piece</option><option>Just saying hello</option></select></label>'
            f'<label>Message<textarea name="message" rows="6" required placeholder="Tell me about the person, the occasion, their hobbies…"></textarea></label>'
            f'<button class="btn" type="submit">Send message</button><p class="form-note" role="status" hidden></p></form></section>')


def main():
    t = 'a'   # the chosen design: "Paper & Ink"
    for f in os.listdir(ROOT):
        if f.startswith('cat-') and f.endswith('.html'): os.remove(os.path.join(ROOT, f))  # pages of removed categories
    page(t, 'index.html', 'Home', home_a(), 'index.html')
    page(t, 'gallery.html', 'Gallery', gallery_page(), 'gallery.html')
    for c in CATS:
        page(t, f'cat-{c["slug"]}.html', c['name'], cat_page(c), 'gallery.html')
    page(t, 'process.html', 'How I Make Them', process_page(), 'process.html')
    page(t, 'commissions.html', 'Commissions', commissions_page(), 'commissions.html')
    page(t, 'about.html', 'About', about_page(), 'about.html')
    page(t, 'contact.html', 'Contact', contact_page(), 'contact.html')
    # Old naavanaslavsky.com addresses -> new pages (GitHub Pages serves /hobbies from hobbies.html)
    OLD = {'home': 'index.html', 'hobbies': 'cat-hobbies.html', 'professions': 'cat-professions.html', 'music': 'cat-music.html',
           'gardening': 'cat-gardening.html', 'couples': 'cat-couples.html', 'milestones-and-special-occasions': 'cat-milestones.html',
           'home-old': 'cat-judaica.html', 'events': 'commissions.html'}
    for old, new in OLD.items():
        open(os.path.join(ROOT, old + '.html'), 'w').write(
            f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Moved · Naava Naslavsky</title>'
            f'<link rel="canonical" href="https://www.naavanaslavsky.com/{new}"><meta name="robots" content="noindex">'
            f'<meta http-equiv="refresh" content="0; url={new}"><script>location.replace("{new}" + location.hash)</script></head>'
            f'<body><p>This page has moved: <a href="{new}">continue to the new page</a>.</p></body></html>')
    print('built site:', 7 + len(CATS), 'pages +', len(OLD), 'redirects from old addresses')


if __name__ == '__main__':
    main()
