all: build push

build:
	docker build -t longshoreman/controller .

push:
	docker push longshoreman/controller

.PHONY: build push
