from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0005_profile_about_visibility_and_more'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='user',
            name='email_verified',
        ),
        migrations.RemoveField(
            model_name='user',
            name='phone_verified',
        ),
        migrations.DeleteModel(
            name='EmailVerification',
        ),
        migrations.DeleteModel(
            name='PhoneNumberVerification',
        ),
    ]
