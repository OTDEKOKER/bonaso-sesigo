from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0011_narrativereport'),
    ]

    operations = [
        migrations.AddField(
            model_name='projectindicator',
            name='target_group',
            field=models.CharField(
                blank=True,
                default='',
                help_text='e.g. PLHIV, Youth 15-24, Women, Key Populations',
                max_length=255,
            ),
            preserve_default=False,
        ),
    ]
