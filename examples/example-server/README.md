# Example Model Server Instance

This package provides an example of how to configure an instance of the _Model Server_ with plug-ins using the server framework.

## Setup

See the [parent readme](../../README.md) for details of how to set up and build the project.

## How to Run

This section provides a walk-through of the steps to launch the example _Model Server_ instance.

### Launch The Upstream Model Server

The node.js server is a customization layer in front of an instance of the Java Model Server, referred to in the server architecture as the _Upstream Model Server_.
It provides the EMF-based management of resources and most of the API endpoints that are just forwarded by the node.js layer.

Open an Eclipse workspace on the Java projects in the `eclipse-emfcloud/emfcloud-modelserver` repository.
Be sure to import the projects from the `/examples/` tree as well as `/bundles/`.
Edit the **ExampleServerLauncher** launch configuration in Eclipse, adding `-p 8081` to the Program Arguments.
Then launch this configuration to start the _Model Server_, in this context filling the role of _Upstream Model Server_.

The server will start listening on port `8081` and its workspace will be initialized to the `/examples/org.eclipse.emfcloud.modelserver.example/src/main/resources/workspace/` directory.
This workspace contains a minimal example Coffee model `SuperBrewer3000.coffee`.

### Launch the Model Server node.js Layer

In the root of this repository, start the _Model Server_ server via

```console
$ yarn start
[2022-02-09 10:59:46.415 ModelServerPluginContext] info: Initializing plug-in ExampleCustomCommandPlugin.
[2022-02-09 10:59:46.418 ExampleCustomCommandPlugin] info: Registered example increment-duration command provider.
[2022-02-09 10:59:46.418 ModelServerPluginContext] info: Initializing plug-in ExampleCustomValidationPlugin.
[2022-02-09 10:59:46.418 ExampleCustomValidationPlugin] info: Registered example Coffee Machine validation provider.
[2022-02-09 10:59:46.426 ModelServer] info: Model Server (node.js) listening on port 8082.
```

The _Model Server_ will listen for incoming connections on port 8082 and will connect to the _Upstream Model Server_ on port 8081.
All connections are on the local host.
