import os
import requests
import time
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


class TTSService:
    def __init__(self):
        self.providers = {
            "openai": OpenAITTS(),
            "yandex": YandexTTS(),
            "google": GoogleTTS(),
        }
        self.default_provider = "openai"

    def detect_language(self, text):
        """Простой детектор языка"""
        if not text:
            return "en-US"

        ru_chars = len([c for c in text.lower() if "а" <= c <= "я"])
        en_chars = len([c for c in text.lower() if "a" <= c <= "z"])

        if ru_chars > en_chars:
            return "ru-RU"
        else:
            return "en-US"

    def generate_audio(
        self, text, voice_type="alloy", language="auto", provider=None
    ):
        provider = provider or self.default_provider

        # Автоопределение языка если нужно
        if language == "auto":
            language = self.detect_language(text)

        try:
            start_time = time.time()
            audio_content = self.providers[provider].generate(
                text, voice_type, language
            )
            processing_time = time.time() - start_time

            return audio_content, processing_time

        except Exception as e:
            logger.error(f"TTS generation failed with {provider}: {e}")
            # Пробуем другие провайдеры
            for backup_provider in ["yandex", "google"]:
                if backup_provider != provider:
                    try:
                        start_time = time.time()
                        audio_content = self.providers[
                            backup_provider
                        ].generate(text, voice_type, language)
                        processing_time = time.time() - start_time
                        return audio_content, processing_time
                    except Exception as fallback_error:
                        logger.error(
                            f"Fallback {backup_provider} also failed: {fallback_error}"
                        )
            raise Exception(f"All TTS providers failed: {e}")


class OpenAITTS:
    def generate(self, text, voice_type, language):
        try:
            from openai import OpenAI
        except ImportError:
            raise Exception(
                "OpenAI library not installed. Run: pip install openai"
            )

        api_key = getattr(settings, "OPENAI_API_KEY", None)
        if not api_key:
            raise Exception("OPENAI_API_KEY not configured in settings")

        client = OpenAI(api_key=api_key)

        # Обрезаем текст если слишком длинный
        text = text[:4096]

        response = client.audio.speech.create(
            model="tts-1", voice=voice_type, input=text
        )

        return response.content


class YandexTTS:
    def generate(self, text, voice_type, language):
        api_key = getattr(settings, "YANDEX_TTS_API_KEY", None)
        if not api_key:
            raise Exception("YANDEX_TTS_API_KEY not configured")

        # Маппинг голосов для Яндекс
        voice_mapping = {
            "alloy": "alena",
            "echo": "filipp",
            "nova": "alena",
            "onyx": "filipp",
            "fable": "alena",
            "shimmer": "alena",
        }

        # Маппинг языков для Яндекс
        lang_mapping = {
            "ru-RU": "ru-RU",
            "en-US": "en-US",
        }

        url = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize"
        headers = {"Authorization": f"Api-Key {api_key}"}

        data = {
            "text": text[:5000],  # Яндекс ограничение
            "lang": lang_mapping.get(language, "ru-RU"),
            "voice": voice_mapping.get(voice_type, "alena"),
            "format": "mp3",
            "sampleRateHertz": 48000,
        }

        response = requests.post(url, headers=headers, data=data, timeout=30)

        if response.status_code != 200:
            raise Exception(f"Yandex TTS error: {response.text}")

        return response.content


class GoogleTTS:
    def generate(self, text, voice_type, language):
        try:
            from google.cloud import texttospeech
        except ImportError:
            raise Exception("Google Cloud TTS library not installed")

        # Маппинг голосов для Google
        voice_mapping = {
            "ru-RU": {
                "alloy": "ru-RU-Wavenet-D",
                "echo": "ru-RU-Wavenet-B",
                "nova": "ru-RU-Wavenet-A",
                "onyx": "ru-RU-Wavenet-C",
            },
            "en-US": {
                "alloy": "en-US-Neural2-F",
                "echo": "en-US-Neural2-J",
                "nova": "en-US-Neural2-A",
                "onyx": "en-US-Neural2-D",
            },
        }

        client = texttospeech.TextToSpeechClient()

        voice_config = voice_mapping.get(language, {}).get(voice_type)
        if not voice_config:
            # Голос по умолчанию для языка
            voice_config = f"{language}-Wavenet-A"

        synthesis_input = texttospeech.SynthesisInput(text=text[:5000])
        voice = texttospeech.VoiceSelectionParams(
            language_code=language, name=voice_config
        )
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3
        )

        response = client.synthesize_speech(
            input=synthesis_input, voice=voice, audio_config=audio_config
        )

        return response.audio_content
