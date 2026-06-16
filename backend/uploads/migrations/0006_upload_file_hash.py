from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('uploads', '0005_exportjob_mode'),
    ]

    operations = [
        migrations.AddField(
            model_name='upload',
            name='file_hash',
            field=models.CharField(blank=True, db_index=True, max_length=64),
        ),
    ]
