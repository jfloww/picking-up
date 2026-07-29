from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
        # Must run after auth's own migrations finish altering `auth_user`
        # columns: on SQLite, ALTER TABLE is implemented as a table rebuild,
        # which would silently drop this untracked RunSQL index if a later
        # auth migration ran after it.
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.RunSQL(
            sql="CREATE UNIQUE INDEX unique_auth_user_email ON auth_user (email)",
            reverse_sql="DROP INDEX unique_auth_user_email",
        ),
    ]
