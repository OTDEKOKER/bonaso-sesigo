"""pytest settings — mirror `manage.py test`, on an isolated in-memory SQLite DB.

Pointed at by ``pytest.ini``. pytest does not put ``'test'`` in ``sys.argv`` the
way ``manage.py test`` does, so ``core.settings`` would otherwise (a) leave
``SECURE_SSL_REDIRECT`` on and 301-redirect every test-client request, and
(b) hit the production guard that refuses to start on SQLite. We add ``'test'``
to argv before importing, so ``core.settings``' own ``TESTING`` branch handles
both — the test environment is then identical to the Django test runner's.
"""
import sys

if 'test' not in sys.argv:
    sys.argv.append('test')

from core.settings import *  # noqa: E402,F401,F403

# Always run on a private in-memory SQLite database — fast, isolated, and can
# never reach the Postgres configured in .env (so a pytest run can't touch
# production data even if DATABASE_URL is set in the environment).
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

# Don't spend bcrypt time hashing fixture passwords.
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
