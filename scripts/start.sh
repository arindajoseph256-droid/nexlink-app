#!/bin/sh
# Start NEXLINK with Daphne (ASGI) — used by the managed preview and any
# host that injects a PORT env var (defaults to 8000 locally).
: "${PORT:=8000}"

# Ensure tables exist (idempotent; on Render the build step already ran
# migrations against Postgres, so this is a no-op there).
python3 manage.py migrate --noinput

exec daphne -b 0.0.0.0 -p "$PORT" config.asgi:application
