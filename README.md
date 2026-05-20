

### IMPORTANT LEGAL NOTICE

This is a non-profit, fan-made application created purely for entertainment purposes, born after receiving the Pokérole book PDF without knowing anything about it, with the hope that it can help those who, like me, didn't understand much and always forget something.

**Disclaimer & Copyright:**
© 2026 Pokémon. © 1995-2026 Nintendo / Creatures Inc. / GAME FREAK inc. 
Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc., GAME FREAK, and The Pokémon Company. This project is unofficial and is not affiliated with, endorsed, or supported by Nintendo or The Pokémon Company in any way.

All media assets used (including sprites, images, and music) are property of their respective owners and were sourced from online databases or directly from the games. No copyright infringement is intended. 

My original contributions are strictly limited to the HTML, CSS, and JS source code.

**Credits & Resources:**
* System mechanics inspired by: [Pokerole Project](https://www.pokeroleproject.com/)
* Data and assets sourced via: (https://github.com/Pokerole-Software-Development), (https://github.com/Pokerole-Software-Development/Pokerole-Data/tree/master), [PokeroleDex Webapp](https://pokeroledex.nl/pokemon) and [Pokémon Showdown](https://github.com/smogon/pokemon-showdown)



**Special thanks to [Willowlark](https://github.com/Willowlark) and their repository, from which the following credits also apply:**
* The original data (`raw/PokeroleBot`) was compiled by Shadeslayer into this [repository](https://github.com/XShadeSlayerXx/PokeRole-Discord.py-Base).
* `raw/XMLDump` was dumped by SirIntellegence(Brain-Storm.exe) from [this repository](https://github.com/SirIntellegence/pokerole-tools/releases/tag/v0.0.0)
* Box sprites were compiled from this [repository](https://github.com/msikma/pokesprite).
* Home sprites were ripped from [the spriter's resource](https://www.spriters-resource.com/nintendo_switch/pokemonhome/).
* Pokémon Shuffle style tokens were provided by Shaedn on their Discord.
* The preview files for Version 3.0 were painstakingly set up by Priestess of Neptune.

That said, thank you for downloading my app and have fun!



Below are some details:


The APK file is available at: android\app\build\outputs\apk\debug\app-debug.apk

The app is a mix of English and Italian, so for any language-related changes the code is available to you.

Regarding character sheet creation, everything should work correctly. For Pokémon, some moves may appear odd or incorrect — unfortunately this depends on the database used, and since there are many moves I didn't want to check them one by one. For example, Hidden Power is not handled correctly. Natures and social attributes (trainer and Pokémon) have no real in-app functionality, they are more like annotations. As also specified in the app, stats and moves do not include alterations from abilities and items (moves are calculated automatically, but if a value required a specific stat from "Parameters", that won't be factored in).

Regarding the battle section, you need to be connected to the same Wi-Fi network, once multiplayer is started there are further clarifications to make:

Some moves are not handled, so it's up to the player to use the various prompts at the start or end of a turn to make everything match. For example, Protect has priority over other moves so it should go first, but since it's a support move it's handled by simply rolling accuracy dice — if the move succeeds, the player can activate an effect and manually select the Pokémon to buff, adding +3 to Defense. On the following turn, at the start of the turn, they will select -3 Defense to restore the correct stats. The same logic applies to status conditions: moves or abilities that inflict status conditions are handled by the player — after the move, a modal opens and the player declares everything.

Some moves are not handled at all, such as Sleep Talk or Snore.

Immunities from abilities or items are handled the same way — for example, Levitate grants immunity to Ground-type moves only if declared by the player. When in doubt, declare it every time, since switching — it shouldn't, but — could potentially reset the immunity.

Buffs and debuffs reset on switch, so if a move involves switching while keeping stat changes, reapply them manually at the end/start of the turn.

Moves that force either your own or the opponent's switch are also handled through those modals.

Moves like Disable, Mirror Move, Assist, Encore ... are also managed via the post-move modal.

Items and abilities triggered on contact are handled the same way. The app takes care of the bulk of the battle, while the rest is up to the player, who manages every consequence of the choices made.

Weather-related alterations are not fully implemented (let's say 90%). For example, "moves that would become Complete Heal under Sunny weather will only restore 1 HP instead" during Rain weather is not handled.

In the pokemon-card, a Pokémon can learn all the moves in its learnset, but only the first 4 will be brought into battle.

The consumption of will points is not limited because I consider it useful for better understanding the battle dynamics, therefore honesty among players, since you can read on the console if too many rerolls are made.

Furthermore, to make the app more enjoyable, additional features are available: trainer sheets can be exported and imported freely from both screens through a menu that uses JSON files. The same menu also includes a small dice roller and some notes on the ruleset. On the trainer screen, there are no limits to what can be added to the bag (including made-up items, since this is DnD) or to the PC (since in Pokémon we don't have the 6-team limit). Evolutions are handled without any loss of information, and Mega Evolutions will already have their stone if added from the 'Pokédex' (and the Mega Evolution is reversible).

P.S. There's a small (and simple) easter egg in the trainer, lobby, and battle music — hope you enjoy it!
