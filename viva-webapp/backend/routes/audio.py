import os, base64
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from ..services.tts_service import synthesize

router = APIRouter(prefix="/audio", tags=["audio"])

class TTSRequest(BaseModel):
    text: str

@router.post("/tts")
async def text_to_speech(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(400, "Text is required")
    audio_bytes = await synthesize(req.text)
    return Response(content=audio_bytes, media_type="audio/mpeg")

@router.post("/tts/b64")
async def text_to_speech_b64(req: TTSRequest):
    if not req.text.strip():
        raise HTTPException(400, "Text is required")
    audio_bytes = await synthesize(req.text)
    return {"audio_b64": base64.b64encode(audio_bytes).decode(), "mime": "audio/mpeg"}
