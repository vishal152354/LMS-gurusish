import os, tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter(tags=["transcribe"])

_model = None

def _get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel("base", device="cpu", compute_type="int8")
    return _model

@router.post("/student/viva/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    data = await audio.read()
    if len(data) < 1000:
        raise HTTPException(400, "Audio too short")

    suffix = ".webm"
    if audio.filename and "." in audio.filename:
        suffix = "." + audio.filename.rsplit(".", 1)[-1]

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    try:
        model = _get_model()
        segments, _ = model.transcribe(tmp_path, language="en", beam_size=5)
        text = " ".join(seg.text.strip() for seg in segments).strip()
    except Exception as e:
        raise HTTPException(500, f"Transcription failed: {e}")
    finally:
        os.unlink(tmp_path)

    if not text:
        raise HTTPException(422, "No speech detected")

    return {"transcript": text}
