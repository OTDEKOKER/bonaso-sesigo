import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('indicators', '0009_assessmentquestion_question_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='indicator',
            name='denominator_indicator',
            field=models.ForeignKey(
                blank=True,
                help_text=(
                    'For percentage indicators: the denominator indicator. '
                    '% = this indicator achieved / denominator indicator achieved.'
                ),
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='numerator_indicators',
                to='indicators.indicator',
            ),
        ),
    ]
