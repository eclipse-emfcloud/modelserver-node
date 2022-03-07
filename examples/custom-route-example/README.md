# Custom Route Provider Example

This package provides an example of a custom route provider plug-in for the _Model Server_.
It provides an API endpoint that greets clients.

## Details

The plug-in contributes a route provider that establishes custom API Endpoints on `/api/v2/custom/greeter` supporting requests to greet callers and report who has been greeted during the server session.
Responses follow the typical _Model Server_ JSON protocol.

```plain
> GET http://localhost:8082/api/v2/custom/greeter/greet/Fred
< 200 OK
  {
    "type": "success",
    "data": "Hello, Fred!"
  }

> GET http://localhost:8082/api/v2/custom/greeter/who
< 200 OK
  {
    "type": "success",
    "data": [
      "Alice",
      "Bob",
      "Cathy",
      "Fred"
    ]
  }
```

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
This will be used to build requests for custom commands.

Next, send a request to execute the custom "increment duration" command.
This command is a composite of two commands in a four-step process:

1. Fetch the current value of the `duration` property of the affected `Task`.
   The default is `0` when the property is not present, as is initially the case in this example model.
2. Add `1` to the current `duration` and execute a `set` command to update the duration.
3. Extract the previous value of the `duration` from the `CommandExecutionResult` returned by the server.
   Add the new `duration` value calculated at step 2 to this previous value of the `duration`.
4. Execute a second command that sets the second new `duration` computation into the `Task`.

The example command provider uses a transaction on the target model to execute these two commands, receiving intermediate results that are inputs to later commands in the sequence, in a single undoable operation on the undo stack.

To execute this custom command, send a `PATCH` request to

```plain
    http://localhost:8082/api/v2/models?modeluri=SuperBrewer3000.coffee
```

with the following body:

```json
{
  "data": {
    "type": "modelserver.emfcommand",
    "data": {
      "type": "increment-duration",
      "$type": "http://www.eclipse.org/emfcloud/modelserver/command#//Command",
      "owner": {
        "$ref": "SuperBrewer3000.coffee#//@workflows.0/@nodes.0",
        "$type": "http://www.eclipse.org/emfcloud/coffee/model#//AutomaticTask"
      }
    }
  }
}
```

Note that this uses the EMF URI fragment determined earlier in the `owner.$ref` property.
The command is a custom `increment-duration` type and has no other parameters.

Fetch the model again with a GET request to see the updated `duration` of the **PreHeat** task.

Now repeat the same command a few times, each time getting the model again to see how the `duration` changes.

> Do you recognize a pattern?

#### Undo the Commands

A critical component of this custom command provider framework is the new _Model Server_ protocol for opening and closing transactions on models.
This transaction context allows a command provider plug-in in the _Model Server_ to execute a chain of commands with intermediate results, all captured as a single undoable unit on the stack.
During the transaction, the _Model Server_ receives private notification of the model changes and broadcast to subscribers at large is deferred to the close of the transaction.
If the transaction is rolled back, of course such broadcast will not occur as all changes performed are reverted.

To send an undo command to the _Model Server_, simply send a `GET` request to

```plain
    http://localhost:8082/api/v2/undo?modeluri=SuperBrewer3000.coffee
```

Follow that up with a `GET` on the `/api/v2/models` endpoint to see how the `duration` of the **PreHeat** `Task` is reverted.
The intermediate `+1` increments are not evident because both original commands are undone at each step.
