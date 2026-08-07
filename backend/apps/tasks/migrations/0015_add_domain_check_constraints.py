from django.db import migrations, models


class Migration(migrations.Migration):
    # RF-006 round 2: portable CheckConstraints for the two cross-field
    # domain rules cheap enough to express with Django's Q-based constraint
    # API across SQLite/PostgreSQL/Oracle. Defense-in-depth below
    # TaskSerializer.validate(), which already enforces both plus the eight
    # other rules that don't fit a portable CHECK. See
    # docs/refining/2026-08-06-domain-validation.md.
    #
    # Both constraints are simple AddConstraint operations against columns
    # that already exist — no new column and no data backfill, so (unlike
    # 0009/0010-0012's multi-step split) there's no fallible data step for
    # a partial Oracle DDL failure to leave half-applied. The local SQLite
    # dev/test database had zero existing Task rows at the time this
    # migration was written, so there was nothing to check for pre-existing
    # violations against; this has not been verified against production
    # Oracle data (same open gap as RF-012).
    dependencies = [
        ("tasks", "0014_truncate_overlength_subtask_fields"),
    ]

    operations = [
        migrations.AddConstraint(
            model_name="task",
            constraint=models.CheckConstraint(
                condition=(
                    (models.Q(scope_kind="bucket") & models.Q(bucket_category__isnull=False))
                    | (~models.Q(scope_kind="bucket") & models.Q(bucket_category__isnull=True))
                ),
                name="bucket_category_set_iff_scope_kind_is_bucket",
            ),
        ),
        migrations.AddConstraint(
            model_name="task",
            constraint=models.CheckConstraint(
                condition=~(
                    models.Q(repeat_weekdays__isnull=False) & models.Q(repeat_source__isnull=False)
                ),
                name="repeat_weekdays_and_repeat_source_are_mutually_exclusive",
            ),
        ),
    ]
