"""Text normalization + language tagging shared by every benchmark script.

The same normalizer is applied to references and hypotheses so that WER
measures recognition errors, not formatting differences. It is deliberately
conservative: it does not translate, expand numbers, or respell Tagalog.
"""

from __future__ import annotations

import re
import unicodedata

# GigaSpeechBench annotation markup that is not speech.
_MARKUP = [
    re.compile(r"\((?:overlap|/overlap)\)", re.I),
    re.compile(r"\(~\)"),
    re.compile(r"\((?:laugh|laughter|noise|music|cough|breath|inaudible|unintelligible|foreign)[^)]*\)", re.I),
    re.compile(r"\[[^\]]*\]"),  # [music], [laughter], ...
    re.compile(r"<[^>]*>"),
    re.compile(r"#"),
]

# Fillers are dropped on both sides: references are inconsistent about them and
# the product removes them in the optional "clean" layer anyway.
FILLERS = {"uh", "um", "uhm", "umm", "hmm", "mm", "ah", "eh", "er", "erm", "mhm", "uhh", "ahh"}

# High-frequency Tagalog function words that essentially never occur in English
# text. Used only to tag segments as Taglish vs English; not for scoring.
TAGALOG_MARKERS = {
    "ang", "ng", "mga", "sa", "yung", "iyong", "kasi", "po", "lang", "naman", "talaga",
    "hindi", "ako", "ko", "siya", "sila", "kami", "tayo", "natin", "namin", "niya",
    "nila", "ikaw", "ba", "din", "rin", "nang", "meron",
    "wala", "yan", "iyan", "ito", "yun", "iyon", "dito", "doon", "diyan", "kung",
    "pero", "tapos", "kaya", "parang", "ganun", "ganon", "ganito", "ano", "sige",
    "opo", "oo", "gusto", "alam", "pag", "kapag", "nga",
    "diba", "nyo", "ninyo", "kayo", "akin", "amin", "atin", "mismo", "ulit",
}
# Deliberately excluded because they are also English words / names:
# may, pa, na, ka, mo, di, para, eh.


# Tokens that are valid English dictionary entries but, in Filipino speech, are
# almost always Tagalog (or honorifics / single letters).
_NOT_ENGLISH = {
    "na", "sa", "mo", "po", "at", "may", "ba", "to", "di", "ni", "o", "a", "ate", "no",
    "lola", "lolo", "san", "e", "p", "m", "s", "b", "man", "ma", "la", "ha", "ay", "ka",
    "pa", "eh", "para", "ang", "ng", "ko", "kay", "yan", "sila", "bata", "bahay", "anak",
    "ano", "oo", "ho", "din", "rin", "tao", "mag", "nag", "pag", "kuya", "tita", "tito",
}

_english_vocab: set[str] | None = None


def english_vocab() -> set[str]:
    """English words actually used by Filipino speakers: the macOS system
    dictionary intersected with the PHL-EN (Philippine English) references."""
    global _english_vocab
    if _english_vocab is None:
        import json
        from collections import Counter
        from pathlib import Path

        meta = Path(__file__).parent / "data" / "gsb" / "phl-en.json"
        used = Counter(
            w for a in json.load(open(meta))["audios"] for s in a["segments"]
            for w in normalize(s["text"]).split()
        )
        dictionary = {w.strip().lower() for w in open("/usr/share/dict/words")}
        dictionary |= {"dont", "thats", "its", "im", "youre", "okay", "ok", "gonna", "wanna", "yeah"}
        _english_vocab = {
            w for w, c in used.items()
            if c >= 2 and w in dictionary and w not in _NOT_ENGLISH and w not in TAGALOG_MARKERS
        }
    return _english_vocab


def english_ratio(text: str) -> float:
    words = normalize(text).split()
    if not words:
        return 0.0
    vocab = english_vocab()
    return sum(w in vocab for w in words) / len(words)


def normalize(text: str) -> str:
    t = unicodedata.normalize("NFKC", text)
    for rx in _MARKUP:
        t = rx.sub(" ", t)
    t = t.lower()
    # Tagalog elision apostrophes ('yung, 'di, 'to) and curly quotes.
    t = t.replace("’", "'").replace("‘", "'")
    t = re.sub(r"(?<![a-z0-9])'|'(?![a-z0-9])", " ", t)
    t = t.replace("'", "")
    # Keep hyphens inside words (nagre-reply, pa-check) as a single token.
    t = re.sub(r"(?<=[a-z0-9])-(?=[a-z0-9])", "", t)
    t = re.sub(r"[^\w\s]", " ", t)
    t = t.replace("_", " ")
    words = [w for w in t.split() if w not in FILLERS]
    return " ".join(words)


def tagalog_ratio(text: str) -> float:
    words = normalize(text).split()
    if not words:
        return 0.0
    return sum(w in TAGALOG_MARKERS for w in words) / len(words)


def classify(text: str, source_set: str) -> str:
    """english | taglish | filipino — the evaluation bucket for a segment."""
    if source_set == "PHL-EN":
        # In practice PHL-EN is Philippine-accented English (~0.5% of segments
        # contain any Tagalog), so it is the English bucket.
        return "english" if tagalog_ratio(text) == 0 else "taglish"
    # PHL is conversational Tagalog; natural speech mixes in English heavily.
    words = normalize(text).split()
    en = english_ratio(text)
    if en >= 0.25 and sum(w in english_vocab() for w in words) >= 2:
        return "taglish"
    if en <= 0.10:
        return "filipino"
    return "mixed-light"  # a few loanwords; excluded to keep buckets crisp
