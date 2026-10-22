#!/usr/bin/env python3
"""Generate golden parity vectors from ref/pixiv-dl (ENG-003).

Run as `python3 -I scripts/gen-golden.py` (or `npm run golden`). Outputs:

  test/golden/safe_component.json  [{in, out}]  safe_component(in)
  test/golden/plain_text.json      [{in, out}]  plain_text(in)
  test/golden/write_metadata.json  [{name, artworkId, body, fileText}]
                                   fileText = bytes write_metadata(body) wrote
  src/shared/html-entities.ts      Python's html.unescape tables, for unescapeHtml

`--check` regenerates in memory and exits 1 if any committed file differs.
Output is deterministic: no randomness, no set iteration, fixed key order.
"""

import sys

# Before anything from ref/ is imported, so no ref/__pycache__/ is ever written.
sys.dont_write_bytecode = True

import html  # noqa: E402
import html.entities  # noqa: E402
import importlib.machinery  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import os  # noqa: E402
import tempfile  # noqa: E402
import types  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF_SCRIPT = os.path.join(ROOT, "ref", "pixiv-dl")

SAFE_COMPONENT_OUT = os.path.join(ROOT, "test", "golden", "safe_component.json")
PLAIN_TEXT_OUT = os.path.join(ROOT, "test", "golden", "plain_text.json")
WRITE_METADATA_OUT = os.path.join(ROOT, "test", "golden", "write_metadata.json")
HTML_ENTITIES_OUT = os.path.join(ROOT, "src", "shared", "html-entities.ts")


def load_reference():
    # The script exits at import time without browser_cookie3; none of the
    # functions under test touch it.
    sys.modules["browser_cookie3"] = types.ModuleType("browser_cookie3")
    loader = importlib.machinery.SourceFileLoader("pixiv_dl", REF_SCRIPT)
    spec = importlib.util.spec_from_loader("pixiv_dl", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def unique(items):
    return list(dict.fromkeys(items))


def python_whitespace():
    """Every code point for which str.isspace() is true (also re's \\s)."""
    return [chr(c) for c in range(0x110000) if chr(c).isspace()]


# ---------------------------------------------------------------- safe_component

def safe_component_inputs():
    ws = python_whitespace()
    inputs = []

    # PRD §4.4 and design-settings-model.md examples.
    inputs += [
        "みずき", "  Sora / 空 :: 2nd  ", "...", "135882741", "40285173",
        "雨上がりの渋谷", "pixiv", "~sora~", "\U0001f469\u200d\U0001f3a8Mika", "CON",
    ]

    # Every Python whitespace code point: inside, alone, around, and as a run.
    for ch in ws:
        inputs += [f"a{ch}b", ch, f"{ch}a{ch}", f"a{ch}{ch}{ch}b"]
    inputs += [
        "a \u3000\u2003b", "a\u0085\u00a0b", "初音\u3000ミク", "a _ b", "a \t b",
        "\u3000\u3000", " \u00a0 ",
    ]
    # Whitespace in JS but not Python, and zero-width characters that are neither.
    inputs += ["a\ufeffb", "\ufeffabc", "a\u180eb", "a\u200bb", "abc\u200b", "\u2060"]

    # ASCII controls (C0 and DEL), plus a few C1 controls the script keeps.
    for c in list(range(0x00, 0x20)) + [0x7f]:
        inputs.append(f"a{chr(c)}b")
    inputs += [
        "\x00", "\tabc\t", "\x01" * 10 + "a" * 60, "\x80", "\x9f", "a\x9cb",
        "\x85abc\x85", "a\u00adb",
    ]

    # Separators the script removes, and Chrome-illegal ones it keeps.
    for ch in '/:\\*?"<>|':
        inputs += [f"a{ch}b", ch]
    inputs += [
        'a/:\\*?"<>|b', "AC/DC", "Re:ゼロ", "C:\\Users\\sora", "http://example.com/x",
        "a/b/c", ":::", "\\\\", 'He said "hi"', "what?", "a*b", "a|b", "<script>",
    ]

    # Emoji, ZWJ sequences, modifiers, flags, variation selectors.
    inputs += [
        "\U0001f468\u200d\U0001f469\u200d\U0001f467\u200d\U0001f466",
        "\U0001f3f3\ufe0f\u200d\U0001f308", "\U0001f44d\U0001f3fd", "\U0001f1ef\U0001f1f5",
        "\u2764\ufe0f", "a\u200db", "\u200d", "\U0001f600", "Caf\u00e9 \u2615",
    ]

    # NFC/NFD pairs and other normalization-sensitive input.
    pairs = [
        ("\u304c", "\u304b\u3099"),          # が
        ("\u00e9", "e\u0301"),               # é
        ("\u00c5", "A\u030a"),               # Å
        ("\u00f1", "n\u0303"),               # ñ
        ("\uac00", "\u1100\u1161"),          # 가
        ("\u30d1", "\u30cf\u309a"),          # パ
        ("\u01d6", "u\u0308\u0304"),         # ǖ
    ]
    for nfc, nfd in pairs:
        inputs += [nfc, nfd, f"x{nfd}y"]
    inputs += [
        "\u212b", "\u2126", "\uf900", "\u0301a", "\uff8a\uff9f", "\ufb01", "\u2163",
        "\uff21\uff22\uff23", "\uff76\uff80\uff76\uff85",
        "\u304b\u3099" * 20, "\u304b\u3099" * 21,
    ]

    # UTF-8 truncation boundaries: 59/60/61 bytes with 1-, 2-, 3- and 4-byte characters.
    a = "a"
    inputs += [a * 59, a * 60, a * 61, a * 100]
    inputs += ["あ" * 19, "あ" * 20, "あ" * 21, "あ" * 40]
    inputs += [a * k + "あ" * 19 for k in range(1, 5)]
    inputs += [a * k + "あ" for k in (56, 57, 58, 59, 60)]
    inputs += [a * k + "\u00e9" for k in (57, 58, 59, 60)]
    inputs += [a * k + "\u00f1" for k in (58, 59)]
    inputs += [a * k + "\U0001f600" for k in (55, 56, 57, 58, 59, 60)]
    inputs += [
        "\U0001f600" * 15, "\U0001f600" * 16, a + "\U0001f600" * 15,
        "\U0001f469\u200d\U0001f3a8" * 6, "雨上がりの渋谷" * 3, "é" * 30, "é" * 31,
        a * 59 + "e\u0301",
    ]

    # Leading/trailing "._ " runs, including runs exposed by truncation.
    inputs += [
        "._ abc ._", "...abc...", "___abc___", "   abc   ", "._._abc", "abc._._",
        ". _ . abc", "a.b_c d", "a..b", ".hidden", "file.", "a_", "_a", "a__b",
        "~sora~-1", a * 59 + "_b", a * 58 + ".b", a * 59 + ".b", a * 59 + " b",
        "x" + "." * 59 + "y", "あ" * 19 + "._b", "あ" * 19 + "_" + "あ",
        "_" * 70 + "a", "a" + " " * 70 + "b",
    ]

    # Empty and all-separator strings.
    inputs += [
        "", ".", "..", "....", "." * 61, " ", "_", "._ ", "\u3000", "/", "\x1f",
        "._ " * 30, "/ : \\",
    ]

    # Assorted real-world names.
    inputs += [
        "名前 (なまえ)", "50% off", "a#b&c", "Ⅳ", "\ue000", "\ufffe", "\uffff", "\ufdd0",
        "\U0001fffe", "\U000e0001", "\u0130stanbul", "Ꙭ", "𠮷野家",
    ]
    return unique(inputs)


def gen_safe_component(ref):
    return [{"in": s, "out": ref.safe_component(s)} for s in safe_component_inputs()]


# ---------------------------------------------------------------- plain_text

def plain_text_inputs():
    ws = python_whitespace()
    inputs = []

    # <br> variants: case, Python \s whitespace inside, near-misses removed as tags.
    inputs += [
        "", "plain", "a<br>b", "a<br/>b", "a<br />b", "a<BR>b", "a<Br  />b", "a<bR\t/>b",
        "a<br\n>b", "a<br\u3000/>b", "a<br\u0085>b", "a<br\x1c>b", "a<br\ufeff>b",
        "a<br\u00a0\u2028/>b", "a<br//>b", "a<br/ >b", "a<brx>b", 'a<br class="x">b',
        "a<br><br>b", "<br>a<br>", "a<br<br>>b",
    ]
    # </p> and </div>, including Python re.I's dotless/dotted I.
    inputs += [
        "a</p>b", "a</P>b", "<p>one</p><p>two</p>", "a</p >b", "a</div>b", "a</DIV>b",
        "a</d\u0131v>b", "a</d\u0130v>b", "a</Div>b", "<div>a</div><div>b</div>", "a<p>b",
    ]
    # Nested and stray tags.
    inputs += [
        "<b><i>x</i></b>", '<a href="https://example.com" target="_blank">link</a>',
        "<div><p>a</p></div>", "<strong>強調</strong>テキスト", "a < b", "a<b", "1 < 2 > 0",
        "<<b>>", "a>b", "<>", "<\n>x",
    ]
    # Named references: with and without ';', legacy prefixes, unknown names.
    inputs += [
        "&amp;", "&lt;&gt;&quot;&apos;&#39;", "a&nbsp;b", "&amp", "&ampx", "&notit;",
        "&notin;", "&copy2026", "&AElig", "&unknown;", "&unknown", "&LT", "&LT;", "&ltx",
        "&NotEqualTilde;", "&a", "&", "& amp;", "&&amp;", "&amp;amp;", "&;",
        "&constructor;", "&toString;", "&__proto__;", "&hasOwnProperty", "&valueOf",
        "&" + "x" * 33 + ";", "&amp" + "x" * 40, "&lt;b&gt;bold&lt;/b&gt;", "&lt;br&gt;",
        "&ampé", "&amp\r;",
    ]
    # Numeric references, including Python's invalid-codepoint replacement table.
    inputs += [
        "&#65;", "&#x41;", "&#X41;", "&#65", "&#x41", "&#0065;", "&#x0041;", "&#x1F600;",
        "&#128512;", "&#0;", "a&#13;b", "&#128;", "&#x80;", "&#x81;", "&#x9F;", "&#133;x",
        "&#1;", "&#x7f;", "&#11;", "&#xD800;", "&#xDFFF;", "&#x110000;", "&#xFFFE;",
        "&#xFDD0;", "&#x10FFFF;", "&#99999999999;", "&#xFFFFFFFFFFFF;", "&#;", "&#x;",
        "&#xG;", "&#65x", "&#x41g",
    ]
    # Surrounding whitespace: every Python whitespace character, plus JS-only ones.
    for ch in ws:
        inputs.append(f"{ch}x{ch}")
    inputs += [
        "\ufeffx\ufeff", "\u200bx\u200b", "\u180ex\u180e", "&nbsp;x&nbsp;", "&#32;x",
        "&#13;x", "<p> x </p>", "\n\n<br>x<br>\n\n",
    ]
    # Realistic pixiv descriptions.
    inputs += [
        "久しぶりに渋谷で雨。<br />傘を忘れた。<br /><br />"
        "Sketches from a rainy walk home through Shibuya. &amp; more",
        '<a href="/jump.php?https%3A%2F%2Fexample.com" target="_blank">'
        "https://example.com</a><br />Twitter: @sora",
        "line1\r\nline2\nline3",
        "<strong>告知</strong><br/>&#x2605;新刊&#9733;<br>&quot;夏&quot; &lt;3",
    ]
    return unique(inputs)


def gen_plain_text(ref):
    return [{"in": s, "out": ref.plain_text(s)} for s in plain_text_inputs()]


# ---------------------------------------------------------------- write_metadata

FULL_BODY = {
    "illustId": "135882741",
    "illustTitle": "雨上がりの渋谷",
    "illustComment": "ignored",
    "id": "135882741",
    "title": "雨上がりの渋谷",
    "description": "久しぶりに渋谷で雨。<br />傘を忘れた。<br /><br />"
                   "Sketches from a rainy walk home through Shibuya. &amp; more",
    "illustType": 1,
    "createDate": "2026-09-28T21:14:00+09:00",
    "uploadDate": "2026-09-28T21:14:00+09:00",
    "restrict": 0,
    "xRestrict": 0,
    "sl": 2,
    "urls": {"original": "https://i.pximg.net/img-original/img/2026/09/28/21/14/00/135882741_p0.jpg"},
    "tags": {
        "authorId": "40285173",
        "isLocked": False,
        "tags": [
            {"tag": "オリジナル", "locked": True, "deletable": False, "userId": "40285173"},
            {"tag": "風景", "locked": True, "deletable": False, "translation": {"en": "scenery"}},
            {"tag": "渋谷", "locked": True, "deletable": False},
            {"tag": "雨", "locked": False, "deletable": True},
            {"tag": "女の子", "locked": False, "deletable": True},
            {"tag": "漫画", "locked": False, "deletable": True},
        ],
        "writable": True,
    },
    "alt": "#オリジナル 雨上がりの渋谷 - みずきのマンガ",
    "userId": "40285173",
    "userName": "みずき",
    "userAccount": "mizuki",
    "width": 1448,
    "height": 2048,
    "pageCount": 12,
    "bookmarkCount": 1024,
    "likeCount": 512,
    "viewCount": 8192,
}


def without(body, *keys):
    return {k: v for k, v in body.items() if k not in keys}


def with_(body, **changes):
    out = dict(body)
    out.update(changes)
    return out


def write_metadata_cases():
    full = FULL_BODY
    ugoira = with_(
        full, illustId="136004512", id="136004512", illustTitle="ぐるぐる", title="ぐるぐる",
        illustType=2, pageCount=1, xRestrict=1, description="",
        tags={"tags": [{"tag": "うごイラ"}, {"tag": "R-18"}]},
    )
    return [
        ("full body", "135882741", full),
        ("no description key", "135882741", without(full, "description")),
        ("description null", "135882741", with_(full, description=None)),
        ("no illustId and no id", "135882741", without(full, "illustId", "id")),
        ("id only (no illustId)", "135882741", without(full, "illustId")),
        ("empty illustId falls through to id", "135882741", with_(full, illustId="")),
        ("empty tags", "135882741", with_(full, tags={"tags": []})),
        ("no tags key", "135882741", without(full, "tags")),
        ("tags object without tags list", "135882741", with_(full, tags={"authorId": "1"})),
        ("tag entry without tag", "135882741",
         with_(full, tags={"tags": [{"tag": "a"}, {"translation": {"en": "b"}}, {"tag": None}]})),
        ("missing fields", "135882741",
         {"illustId": "135882741", "description": "only <b>this</b>"}),
        ("explicit nulls", "135882741",
         with_(full, illustTitle=None, userName=None, userId=None, createDate=None,
               uploadDate=None, pageCount=None, illustType=None, xRestrict=None)),
        ("empty body", "135882741", {}),
        ("ugoira, R-18", "136004512", ugoira),
        ("R-18G illustration", "135882742",
         with_(full, illustId="135882742", id="135882742", illustType=0, xRestrict=2, pageCount=1)),
        ("non-ASCII and JSON escapes", "135882743",
         with_(full, illustId="135882743", id="135882743",
               illustTitle='"引用" back\\slash\ttab\x01\x1f\x7f\u2028\u2029 \U0001f469\u200d\U0001f3a8 \u304b\u3099',
               userName="Sora / 空 :: 2nd \u00e9e\u0301",
               tags={"tags": [{"tag": "\U0001f600"}, {"tag": "a\"b\\c"}, {"tag": "\u3000"}]})),
        ("description with line breaks", "135882741",
         with_(full, description="  line1<br>line2<BR/>line3<br />line4</p>line5</div>"
                                 "line6\r\nline7&lt;br&gt;&amp;nbsp;&nbsp;\u3000  ")),
        ("description entities only", "135882741", with_(full, description="&nbsp;&#32;&#13;")),
        ("zero and empty values kept", "135882741",
         with_(full, pageCount=0, illustType=0, xRestrict=0, illustTitle="", userName="")),
    ]


def gen_write_metadata(ref):
    cases = []
    with tempfile.TemporaryDirectory() as tmp:
        for name, artwork_id, body in write_metadata_cases():
            ref.write_metadata(body, tmp)
            with open(os.path.join(tmp, "metadata.json"), "rb") as f:
                file_text = f.read().decode("utf-8")
            cases.append({"name": name, "artworkId": artwork_id, "body": body, "fileText": file_text})
    return cases


# ---------------------------------------------------------------- html-entities.ts

def ts_string(s):
    return json.dumps(s, ensure_ascii=True)


def gen_html_entities_ts():
    lines = [
        "// GENERATED by scripts/gen-golden.py from Python's `html` module. Do not edit; run",
        "// `npm run golden`. unescapeHtml (src/shared/metadata.ts) uses these tables so that it",
        "// matches Python's html.unescape exactly.",
        "",
        "/** `html.entities.html5`: names without the leading '&'. Legacy names also appear without ';'. */",
        "export const HTML5_ENTITIES: ReadonlyMap<string, string> = new Map<string, string>([",
    ]
    for name in sorted(html.entities.html5):
        lines.append(f"  [{ts_string(name)}, {ts_string(html.entities.html5[name])}],")
    lines += [
        "]);",
        "",
        "/** `html._invalid_charrefs`: numeric references the HTML5 spec remaps. */",
        "export const INVALID_CHARREFS: ReadonlyMap<number, string> = new Map<number, string>([",
    ]
    for num in sorted(html._invalid_charrefs):
        lines.append(f"  [0x{num:x}, {ts_string(html._invalid_charrefs[num])}],")
    lines += [
        "]);",
        "",
        "/** `html._invalid_codepoints`: numeric references that unescape to ''. */",
        "export const INVALID_CODEPOINTS: ReadonlySet<number> = new Set<number>([",
    ]
    for num in sorted(html._invalid_codepoints):
        lines.append(f"  0x{num:x},")
    lines += ["]);", ""]
    return "\n".join(lines)


# ---------------------------------------------------------------- output

def json_lines(vectors):
    """One vector per line, ASCII-only so invisible and NFD code points stay exact."""
    body = ",\n".join("  " + json.dumps(v, ensure_ascii=True) for v in vectors)
    return "[\n" + body + "\n]\n"


def render_all():
    ref = load_reference()
    return {
        SAFE_COMPONENT_OUT: json_lines(gen_safe_component(ref)),
        PLAIN_TEXT_OUT: json_lines(gen_plain_text(ref)),
        WRITE_METADATA_OUT: json.dumps(gen_write_metadata(ref), ensure_ascii=True, indent=2) + "\n",
        HTML_ENTITIES_OUT: gen_html_entities_ts(),
    }


def read_text(path):
    try:
        with open(path, encoding="utf-8", newline="") as f:
            return f.read()
    except FileNotFoundError:
        return None


def main(argv):
    check = argv == ["--check"]
    if argv and not check:
        sys.exit("usage: python3 -I scripts/gen-golden.py [--check]")
    outputs = render_all()
    stale = []
    for path, text in outputs.items():
        rel = os.path.relpath(path, ROOT)
        if read_text(path) == text:
            continue
        if check:
            stale.append(rel)
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"wrote {rel}")
    if stale:
        print("golden files out of date (run `npm run golden`):", file=sys.stderr)
        for rel in stale:
            print(f"  {rel}", file=sys.stderr)
        return 1
    print("golden files up to date" if check else "golden generation done")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
