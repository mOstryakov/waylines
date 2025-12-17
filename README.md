# Project: Waylines: a platform for author routes

[![Lint • Tests](https://gitlab.crja72.ru/django/2025/autumn/course/projects/team-2/badges/master/pipeline.svg?key_text=Lint%20%7C%20Tests&key_width=160)](https://gitlab.crja72.ru/django/2025/autumn/course/projects/team-2/pipelines)


## Development Mode Installation

### 1. Clone repository

```bash
git clone https://gitlab.crja72.ru/django/2025/autumn/course/projects/team-2.git
```

### 2. Create virtual environment

Linux/MacOS: 
```bash
python3 -m venv venv
```

Windows:
```bash
python -m venv venv
```  

### 3. Activate virtual environment

Linux/MacOS: 
```bash
source venv/bin/activate
```  
Windows:
 ```bash
venv\Scripts\activate
```  

### 4. Installing dependencies

For production: 
```bash
pip install -r requirements/prod.txt
```  
For testing:
 ```bash
pip install -r requirements/test.txt
```  
For development: 
```bash
pip install -r requirements/dev.txt
``` 


### 6. Apply database migrations

All following commands with python manage.py must be executed from the directory containing manage.py (in this case, waylines)  
```bash
cd waylines
```

#### Apply migrations to database

```bash
python manage.py migrate
```

#### Compile translations

```bash
python manage.py compilemessages
```

#### Create a superuser (for access to the admin panel)

```bash
python manage.py createsuperuser
```

#### Collect static files (required for admin panel and styling)  

```bash
python manage.py collectstatic --noinput
```

#### Check migration status

```bash
python manage.py showmigrations
```

### 8. Running tests

```bash
python manage.py test
```

### 9. Run development server:

```bash
python manage.py runserver
```
## Localization

The project supports multiple languages.

### 1. Install gettext (required for working with translations):

**Windows:**

- Download gettext from https://mlocati.github.io/articles/gettext-iconv-windows.html
- Unzip to 
```bash
C:\Program Files\gettext\
```
- Add  
```bash
C:\Program Files\gettext\bin
``` 
to your system PATH

**Linux:**

- Run in the terminal:  
```bash
sudo apt-get install gettext
```

**macOS:**

- Run in the terminal:  
```bash
brew install gettext
```

**2. Working with Translations (example)**:

### Creating message files
For translation into English:  
```bash
django-admin makemessages -l en
``` 
or 
```bash
python manage.py makemessages -l en
```  

For translation into Russian:
```bash
django-admin makemessages -l ru
``` 
or 
```bash
python manage.py makemessages -l ru
```

### Edit translations in 

```bash
locale/en/LC_MESSAGES/django.po
```

### Compile translations

```bash
django-admin compilemessages
``` 
or
```bash
python manage.py compilemessages
```  

### For production deployment:

- Ensure gettext is installed on the server
- Run python manage.py compilemessages after deployment
- Include django.middleware.locale.LocaleMiddleware in settings