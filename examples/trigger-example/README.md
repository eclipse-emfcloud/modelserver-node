# Trigger Example

This package provides an example of a trigger provider plug-in for the _Model Server_.
It provides a trigger that ensures the `duration` of a workflow `Task` in a Coffee model is always a multiple of ten.

## Setup

See the [parent readme](../../README.md) for details of how to set up and build the project.

## How to Run

For detailed instructions how to run the example server configuration that includes this plug-in example, see the [Example Server readme](../example-server/README.md).

### Send Requests to the Model Server

There are a variety of tools available for ad hoc REST interactions with services such as the _Model Server_.
A recommended option is the [Postman](https://www.postman.com) application.

Start by fetching the current state of the model.
Send a `GET` request to

```plain
    http://localhost:8082/api/v2/models?modeluri=SuperBrewer3000.coffee
```

The result should look something like this:

```json
{
  "type": "success",
  "data": {
    "$type": "http://www.eclipsesource.com/modelserver/example/coffeemodel#//Machine",
    "$id": "/",
    "children": [
      // ... structural components here ...
    ],
    "name": "Super Brewer 3000",
    "workflows": [
      {
        "$id": "//@workflows.0",
        "name": "Simple Workflow",
        "nodes": [
          {
            "$type": "http://www.eclipsesource.com/modelserver/example/coffeemodel#//AutomaticTask",
            "$id": "//@workflows.0/@nodes.0",
            "name": "PreHeat",
            "component": {
              "$type": "http://www.eclipsesource.com/modelserver/example/coffeemodel#//BrewingUnit",
              "$ref": "//@children.0"
            }
          }
        ]
      }
    ]
  }
}
```

Make note of the EMF-style URI fragment `$id` of the **PreHeat** task, which must be inferred from the model structure.
The URI fragment is `//@workflows.0/@nodes.0`: the first node of the first workflow in the root `Machine` object.
This will be used to build requests to edit the `duration`.

Next, send a request to change the `duration` property of this task.
For example, this could be the [example custom `increment-duration` command](../custom-command-example/README.md#send-requests-to-the-model-server) or a simple `SetCommand` or `replace` JSON Patch operation.

For example, send a `PATCH` request to

```plain
    http://localhost:8082/api/v2/models?modeluri=SuperBrewer3000.coffee&format=json-v2
```

with the following body:

```json
{
  "data": {
    "type": "modelserver.patch",
    "data": [
      {
        "op": "replace",
        "path": "SuperBrewer3000.coffee#//@workflows.0/@nodes.0/duration",
        "value": 37
      }
    ]
  }
}
```

You also need to set the following two headers for the request to work:

- Content-Length = \<calculated when request is sent>
- Content-Type = application/json

Observe in the response that there is a final change to the `duration` that rounds it up to the next multiple of ten.
A typical response looks something like this:

```json
{
  "type": "success",
  "data": {
    "success": true,
    "patch": [
      {
        "op": "replace",
        "path": "/workflows/0/nodes/0/duration",
        "value": 37
      },
      {
        "op": "replace",
        "path": "/workflows/0/nodes/0/duration",
        "value": 40
      }
    ]
  }
}
```

Fetch the model again with a GET request to see that the final value of the `duration` of the **PreHeat** task is a nice round multiple of ten.

#### Undo the Commands

A critical component of this trigger provider framework is that the changes made by triggers are included in undo/redo of whatever changes triggered them.

To send an undo command to the _Model Server_, simply send a `GET` request to

```plain
    http://localhost:8082/api/v2/undo?modeluri=SuperBrewer3000.coffee
```

Follow that up with a `GET` on the `/api/v2/models` endpoint to see how the `duration` of the **PreHeat** `Task` is reverted.
The intermediate values that are not multiples of ten are not evident because all changes are undone at each step.
