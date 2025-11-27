__all__ = ()

from django import forms
from django.contrib.auth.forms import UserCreationForm
from django.contrib.auth.models import User

from .models import UserProfile


class UserRegistrationForm(UserCreationForm):
    email = forms.EmailField(required=True)

    class Meta:
        model = User
        fields = ["username", "email", "password1", "password2"]

    def save(self, commit=True):
        user = super().save(commit=False)
        user.email = self.cleaned_data["email"]
        if commit:
            user.save()
        return user


class UserProfileForm(forms.ModelForm):
    remove_avatar = forms.BooleanField(required=False, label="Удалить аватар")

    class Meta:
        model = UserProfile
        fields = ["bio", "avatar", "location", "website"]
        widgets = {
            "bio": forms.Textarea(attrs={"rows": 4}),
        }

    def save(self, commit=True):
        instance = super().save(commit=False)

        # Если отмечено удаление аватара
        if self.cleaned_data.get('remove_avatar'):
            if instance.avatar:
                instance.avatar.delete(save=False)
                instance.avatar = None

        if commit:
            instance.save()

        return instance
