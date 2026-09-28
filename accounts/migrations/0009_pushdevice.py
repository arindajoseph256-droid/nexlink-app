from django.db import migrations, models
import django.db.models.deletion
import django.conf


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0008_alter_userpreferences_accent'),
    ]

    operations = [
        migrations.CreateModel(
            name='PushDevice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('token', models.CharField(db_index=True, max_length=255, unique=True)),
                ('platform', models.CharField(default='expo', max_length=16)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='push_devices', to=django.conf.settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ('-updated_at',),
            },
        ),
        migrations.AddIndex(
            model_name='pushdevice',
            index=models.Index(fields=['user'], name='accounts_p_user_id_idx'),
        ),
    ]
