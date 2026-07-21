# Picking Up Backend

Django REST backend for the Picking Up task app.

## Stack

- Django
- Django REST Framework
- Simple JWT
- PostgreSQL for production
- SQLite for local development by default

## Setup

See [`../setup/`](../setup/) for full local development setup, covering both Windows and macOS — this backend also depends on env vars shared with the frontend (CORS origin, etc.), documented in [`../setup/environment-variables.md`](../setup/environment-variables.md).
PS C:\Users\JJ\Desktop\Jaehoon\Projects\picking-up\backend> .\.venv\Scripts\python.exe manage.py runserver
