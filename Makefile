.PHONY: install dev lint typecheck test e2e check
install: ; npm ci
dev: ; npm run dev
lint: ; npm run lint
typecheck: ; npm run typecheck
test: ; npm test
e2e: ; npm run e2e
check: lint typecheck test
