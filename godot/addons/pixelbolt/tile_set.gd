# Opt-in TileSet importer, sharing the same CLI, cleanup and failure policy.
@tool
extends "import.gd"

func _get_importer_name() -> String:
	return "pixelbolt.tile_set"

func _get_visible_name() -> String:
	return "Pixelbolt TileSet"

func _get_resource_type() -> String:
	return "TileSet"

func _get_priority() -> float:
	return 1.0
