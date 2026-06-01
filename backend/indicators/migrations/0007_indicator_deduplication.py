from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('indicators', '0006_alter_indicator_category'),
    ]

    operations = [
        migrations.AddField(
            model_name='indicator',
            name='canonical_indicator',
            field=models.ForeignKey(
                blank=True,
                help_text='Points to the canonical indicator this one was merged into.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='deprecated_variants',
                to='indicators.indicator',
            ),
        ),
        migrations.AddField(
            model_name='indicator',
            name='is_deprecated',
            field=models.BooleanField(
                default=False,
                help_text='Deprecated indicators are hidden from new assignments but preserved for history.',
            ),
        ),
    ]
