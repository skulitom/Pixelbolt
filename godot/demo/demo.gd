extends Node2D
# Plays every animation of the hero, a Pixelbolt recipe imported by the addon as a SpriteFrames, in turn.
# Left and right (or A and D) step through them; the label names the one playing. Looping animations play for
# three seconds, the others to their end.

@onready var hero: AnimatedSprite2D = $Hero
@onready var label: Label = $Label

var names := PackedStringArray()
var current := 0
var shown := 0.0

func _ready() -> void:
	names = hero.sprite_frames.get_animation_names()
	hero.animation_finished.connect(_next)
	_play(0)

func _play(index: int) -> void:
	current = posmod(index, names.size())
	shown = 0.0
	hero.play(names[current])
	label.text = "%s  (%d of %d)   left / right" % [names[current], current + 1, names.size()]

func _next() -> void:
	_play(current + 1)

func _process(delta: float) -> void:
	shown += delta
	if hero.sprite_frames.get_animation_loop(names[current]) and shown >= 3.0:
		_next()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_right"):
		_play(current + 1)
	elif event.is_action_pressed("ui_left"):
		_play(current - 1)
