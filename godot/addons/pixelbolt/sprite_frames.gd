# Default importer; all rendering and resource reconstruction live in import.gd.
@tool
extends "import.gd"

func _get_importer_name() -> String:
	return "pixelbolt.sprite_frames"

func _get_visible_name() -> String:
	return "Pixelbolt SpriteFrames"

func _get_resource_type() -> String:
	return "SpriteFrames"

func _get_priority() -> float:
	return 2.0
