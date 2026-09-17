# Components and variables

Level 3 · Next: [09 Debugging](09-debugging.md)

## What you'll be able to do

- Turn a working interaction into a reusable component.
- Decide what to publish as inputs and outputs.
- Use variables without making a graph mysterious.
- Keep a 200-patch graph readable for you and for whoever opens it next.

## Why components

You built a like button. Now the feed has twelve posts. Copying the graph twelve times gives you twelve places to fix the spring later. A component is one definition with many instances. Edit the definition once, and every instance changes.

Sonobe has three kinds:

| Kind | Holds | Example |
|---|---|---|
| Prototype | The whole screen or flow | Main |
| Layer component | Layers and the patches that make them behave | A like button, a post card, a bottom sheet |
| Patch component | Only patches, like a function | "Snap to nearest", "Clamp" |

## Making a component

1. Get the interaction working first.
2. Select the layers and patches that belong together, like the Heart layer plus its Interaction, Switch, Pop Animation and Transition.
3. Create a component with ⌃⌘G. Sonobe moves your selection into a new component and leaves an instance in its place.
4. Double-click the instance to go inside. Press ⌥↑ to come back out.

```
Main                                         Like Button (component)
├─ Post 1                                    ├─ Heart
│  └─ Like Button 1 ─── instance of ─────▶  │  Interaction ─▶ Switch ─▶ Pop Animation ─▶ Transition
└─ Post 2                                    │
   └─ Like Button 2 ─── instance of ─────▶  └─ published: Tint, Count (inputs) · Liked, Tapped (outputs)
```

Each component is its own file in the project, like `components/like_button.json`, so a change to the button shows up as a change to one file in version control.

## Publishing inputs and outputs

A component's interface is the short list of things the outside world can see.

- Inputs are what varies from instance to instance.
- Outputs are what the rest of the prototype needs to know.

Published inputs on a layer component show up in the inspector as extra properties on every instance, right under the usual ones.

Here's a like button's interface:

| Port | Direction | Type | Why it's published |
|---|---|---|---|
| Tint | Input | Color | Some surfaces use a brand color |
| Count | Input | Number | Each post has its own like count |
| Liked | Output | Boolean | The post shows "You and 12 others" while it's true |
| Tapped | Output | Pulse | The feed can play a haptic, or count likes |

Inside the component, a published input works like any other output you can connect from. In outline notation it's written `$in.tint` (illustrative):

```
patch heart_color transition<color> progress←pop.output start=#8E8E93FF end=$in.tint
```

A good rule is to publish the nouns a designer would change in the inspector and the events other parts of the prototype react to. Keep everything else private. If an instance needs fifteen inputs, you probably have two components.

### Components and loops

Each published input decides what happens when a loop arrives:

- Loop the component. You get one instance per item. A loop of twelve post titles makes twelve post cards.
- Pass the loop in. You get one instance that receives the whole list. A chart component that needs all the values at once works this way.

## Variables: broadcaster and receiver

A Variable Broadcaster gives a value a name, like "Sheet Progress". A Variable Receiver elsewhere in the graph picks that name from a list and outputs the value. It works like a cable you can't see.

```
Sheet Spring ─▶ Variable Broadcaster "Sheet Progress"

         ... far away in the graph ...

Variable Receiver "Sheet Progress" ─▶ Transition 0 → 0.4 ─▶ Backdrop . Opacity
Variable Receiver "Sheet Progress" ─▶ Transition 0 → −40 ─▶ Header . Position Y
```

Variables help when one value feeds many distant places, like a theme color, a safe area inset, or a sheet's progress driving the header, the tab bar and the backdrop.

They hurt when they hide where things come from. Tracing "why did this change?" through a receiver means hunting for its broadcaster by name.

My advice is to keep variables few and name them clearly, and to put each broadcaster right next to the patch whose value it names. To get a value into a component, prefer a published input. It shows up in the inspector, and anyone reading the graph can see where the value comes from.

## Organizing big graphs

Graphs grow fast. These habits keep a big one readable.

### Name patches by what they mean

"Card Is Expanded" says more than "Switch 3". "Sheet Spring" beats "Spring Animation 2". Renaming changes only the display name. Each patch's id never changes, so connections, history and Claude's references keep working.

### Arrange left to right, by job

```
┌ Gestures ─────┐   ┌ State ─────────┐   ┌ Motion ────────┐   ┌ Looks ───────────────────┐
│ Tap Card      │──▶│ Card Is        │──▶│ Card Spring    │──▶│ Card Scale   1 → 1.08    │──▶ layers
│ Tap Backdrop  │   │ Expanded       │   │ (Smooth)       │   │ Card Shadow  0 → 0.2     │
└───────────────┘   └────────────────┘   └────────────────┘   └──────────────────────────┘
```

That mirrors ISAT from guide 02. Anyone who knows the pattern can find their way around.

### Use comments for the why

A comment is a titled, colored frame behind a set of patches. Use one per feature ("Bottom sheet"), and write down the decisions you'd otherwise forget ("Spring matches the iOS sheet. Don't add bounce."). A comment that only repeats the patch names doesn't earn its space.

### Tidy Up

Select some patches and press ⌃T. Sonobe lays them out to follow the flow of data, from left to right.

### Fan out instead of copying

One Pop Animation can feed many Transitions. Duplicate springs drift apart the moment someone tunes one and forgets the other.

### Wrap repeated logic

If you've built "clamp a value between two numbers" three times, turn it into a patch component.

### Mute instead of deleting

Muting a patch bypasses it, so its values pass straight through. It's a quick way to test "what if this patch weren't here" without losing your settings.

You can also ask Claude to do the tidying: "Name every patch by its effect, and add a comment frame per feature." It all lands in history as one entry you can review or undo.

## Try it

1. Turn the tap-to-grow card from guide 01 into a component with a published Title input and an Expanded output.
2. Place three instances with different titles.
3. Build a patch component called Clamp, with Value, Min and Max inputs.
4. Add a "Sheet Progress" variable and use it to drive a backdrop's opacity from the far side of the graph.
5. Rename ten patches by effect, add two comments, and press ⌃T.

## Common mistakes

- Making components too early. Get the interaction working in place first, then wrap it.
- Publishing everything. A long interface is hard to use and harder to change.
- Using variables as the default way to connect things. Cables you can see are easier to debug.
- Naming patches by type. "Switch 7" tells you nothing a month from now.
- Changing one instance and expecting the others to stay the same. Instances share one definition, so if one should differ, publish an input for it.
- Writing comments that describe what patches are instead of why they're there.
