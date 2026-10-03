import os, asyncio, tempfile, re

EDGE_TTS_BIN = os.getenv(
    "EDGE_TTS_BIN",
    os.path.expanduser("~/.hermes/hermes-agent/venv/bin/edge-tts")
)
VOICE = "en-GB-SoniaNeural"

def _clean_text(text: str) -> str:
    text = re.sub(r"```[\s\S]*?```", "", text)
    text = re.sub(r"`[^`]+`", "", text)
    text = re.sub(r"\*{1,3}([^*]+)\*{1,3}", r"\1", text)
    text = re.sub(r"#{1,6}\s", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^\)]+\)", r"\1", text)
    text = re.sub(r"[_~|>]", "", text)
    text = re.sub(r"^\s*[-*+]\s", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+", " ", text).strip()
    return text

async def synthesize(text: str) -> bytes:
    clean = _clean_text(text)
    if not clean:
        clean = "Please proceed."

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        proc = await asyncio.create_subprocess_exec(
            EDGE_TTS_BIN,
            "--voice", VOICE,
            "--text", clean,
            "--write-media", tmp_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)

        if proc.returncode != 0:
            raise RuntimeError(f"edge-tts error: {stderr.decode()}")

        with open(tmp_path, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
