# Custom Commands Example

This package provides an example of a validation provider plug-in for the _Model Server_.
It provides an implementation of a custom validation rule for the root `Machine` in a Coffee model that randomly reports a warning condition.

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
      {
        "$type": "http://www.eclipsesource.com/modelserver/example/coffeemodel#//BrewingUnit",
        "$id": "//@children.0"
      },
      {
        "$type": "http://www.eclipsesource.com/modelserver/example/coffeemodel#//ControlUnit",
        "$id": "//@children.1",
        "processor": {
          "$id": "//@children.1/@processor",
          "clockSpeed": 5,
          "numberOfCores": 10,
          "socketconnectorType": "Z51",
          "thermalDesignPower": 100
        },
        "display": {
          "$id": "//@children.1/@display",
          "width": 10,
          "height": 20
        }
      }
    ],
    "name": "Super Brewer 3000",
    "workflows": [
      // ... workflow model here ...
    ]
  }
}
```

Now send a validation request to check the model against its intrinsic rules and also the custom validation rule provided by the example plug-in.
Send a `GET` request to

```plain
    http://localhost:8082/api/v2/validation?modeluri=SuperBrewer3000.coffee
```

No body content is required.

The response may include a warning like the following:

```json
{
  "severity": 2,
  "source": "@eclipse-emfcloud/coffee-custom-validators-example",
  "code": 1,
  "message": "This is a randomly occurring example diagnostic.",
  "data": [0.7710443792767079],
  "children": [],
  "id": "//@children.1"
}
```

in which the data is a random number between 0 and 1 that decided whether to report the warning.

#### Live Validation

This plug-in provider is included in live model validation, also.
So if there are any clients subscribed for live validation updates (which also may be accomplished via testing tools like Postman) then executing commands as described in the [command providers example](../custom-command-example/README.md) should sometimes include this example warning diagnostic in the validation broadcasts.
