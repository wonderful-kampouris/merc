# Merc monorepo entry points. See docs/spikes/repo-layout.md.
.PHONY: check contracts secret-scan test-deploy deploy plan

# C and ENV are honoured ONLY when typed on the make command line. GNU make imports every
# shell variable as a make variable, so an exported ENV=demo (or `ENV=demo make plan`) would
# otherwise pick the demo workspace without anyone typing it. $(origin) tells them apart.
cmdline = $(if $(filter command line,$(origin $(1))),$($(1)))
ENV_ARG := $(call cmdline,ENV)
C_ARG   := $(call cmdline,C)
# Ignored-from-shell notice, so nobody wonders why their exported ENV did nothing.
SHELL_ENV_NOTE := $(if $(and $(ENV),$(if $(ENV_ARG),,x)),echo "make: ignoring ENV=$(ENV) from the shell environment; pass ENV=dev|demo on the make command line" >&2;)
DEPLOY := infra/deploy/deploy.sh

check:            ## contracts build + all package tests + deploy tests + secret scan
	bash scripts/check.sh

contracts:        ## validate and regenerate spec/contracts
	python3 -I spec/_build/build.py

secret-scan:
	python3 -I scripts/secret-scan.py --root .

test-deploy:
	bash infra/deploy/test/deploy.test.sh
	bash scripts/test/make.test.sh

# make plan C=fn:debrief-process ENV=dev ; make deploy C=fn:debrief-process ENV=dev
# ENV has no default on purpose: demo is reached only by typing ENV=demo after `make`.
plan:
	@$(SHELL_ENV_NOTE) test -n "$(C_ARG)" -a -n "$(ENV_ARG)" || { echo "usage: make plan C=<component> ENV=dev|demo (both on the make command line)" >&2; exit 2; }
	$(DEPLOY) $(C_ARG) --env $(ENV_ARG)

deploy:
	@$(SHELL_ENV_NOTE) test -n "$(C_ARG)" -a -n "$(ENV_ARG)" || { echo "usage: make deploy C=<component> ENV=dev|demo (both on the make command line)" >&2; exit 2; }
	$(DEPLOY) $(C_ARG) --env $(ENV_ARG) --push
