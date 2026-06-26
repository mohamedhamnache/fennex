.PHONY: dev build stop logs db-migrate db-reset install clean

dev:
	docker compose up -d postgres redis
	pnpm install
	turbo dev

docker-dev:
	docker compose up --build

stop:
	docker compose down

logs:
	docker compose logs -f

db-migrate:
	docker compose exec api alembic upgrade head

db-reset:
	docker compose exec api alembic downgrade base
	docker compose exec api alembic upgrade head

install:
	pnpm install

clean:
	find . -name "node_modules" -type d -prune -exec rm -rf {} +
	find . -name ".next" -type d -prune -exec rm -rf {} +
	find . -name "dist" -type d -prune -exec rm -rf {} +
	find . -name "__pycache__" -type d -prune -exec rm -rf {} +
	find . -name ".venv" -type d -prune -exec rm -rf {} +
