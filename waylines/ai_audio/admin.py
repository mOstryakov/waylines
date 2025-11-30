from django.contrib import admin
from .models import AudioGeneration, VoiceProfile, RouteAudioGuide

@admin.register(AudioGeneration)
class AudioGenerationAdmin(admin.ModelAdmin):
    list_display = ['point', 'user', 'status', 'voice_type', 'language', 'created_at']

@admin.register(VoiceProfile)
class VoiceProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'preferred_voice', 'preferred_language', 'auto_generate']

@admin.register(RouteAudioGuide)
class RouteAudioGuideAdmin(admin.ModelAdmin):
    list_display = ['route', 'status', 'total_points', 'created_at']