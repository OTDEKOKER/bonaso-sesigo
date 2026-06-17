from django.conf import settings
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('organizations', '0001_initial'),
        ('indicators', '0001_initial'),
        ('projects', '0018_backfill_assigned_users'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkbookLayout',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=255)),
                ('mode', models.CharField(choices=[('live', 'Live'), ('training', 'Training')], default='live', max_length=10)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('coordinator_organization', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='workbook_layouts', to='organizations.organization')),
                ('created_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_workbook_layouts', to=settings.AUTH_USER_MODEL)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='updated_workbook_layouts', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['coordinator_organization_id', '-is_active', 'name'],
            },
        ),
        migrations.CreateModel(
            name='WorkbookLayoutItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('section_title', models.CharField(blank=True, default='', max_length=255)),
                ('order_index', models.PositiveIntegerField(default=0)),
                ('is_required', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('indicator', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='workbook_layout_items', to='indicators.indicator')),
                ('layout', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='items', to='projects.workbooklayout')),
            ],
            options={
                'ordering': ['layout_id', 'order_index', 'id'],
            },
        ),
        migrations.AddConstraint(
            model_name='workbooklayout',
            constraint=models.UniqueConstraint(condition=models.Q(('is_active', True)), fields=('coordinator_organization', 'mode'), name='unique_active_workbook_layout_per_coordinator'),
        ),
        migrations.AddConstraint(
            model_name='workbooklayoutitem',
            constraint=models.UniqueConstraint(condition=models.Q(('indicator__isnull', False)), fields=('layout', 'indicator'), name='unique_indicator_per_workbook_layout'),
        ),
    ]
