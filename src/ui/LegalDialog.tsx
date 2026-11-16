import { tr } from '../i18n/index'

/** "About & legal": the unofficial-project disclaimer and the scope of the license. A notice does not replace permission. */
export function LegalDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="max-h-full w-full max-w-md overflow-y-auto rounded-lg bg-stone-800 p-4 text-sm" role="dialog" aria-label={tr('About & legal')} onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-2 font-semibold">{tr('About & legal')}</h2>
        <p>{tr('Tabletop Trainer is an independent, unofficial, non-commercial fan project. It is not affiliated with, endorsed by, sponsored by or licensed by Games Workshop Limited.')}</p>
        <p className="mt-2">{tr('“Warhammer”, “Warhammer 40,000” and the names of related factions, units and game terms are trademarks or registered trademarks of Games Workshop Limited. They are used here only to identify the tabletop game this tool helps people learn. This project contains no Games Workshop logos, artwork, photographs, models or rulebook text.')}</p>
        <p className="mt-2">{tr('The Apache License 2.0 covers only the original code and documentation of this project. It grants no rights in the trademarks, characters, settings or other intellectual property of third parties. Game data and names are used for identification and are not licensed by this project.')}</p>
        <p className="mt-2">{tr('If you are a rights holder and believe something here should be changed or removed, please open an issue in the project’s GitHub repository.')}</p>
        <button className="btn btn-primary mt-3 w-full" onClick={onClose}>{tr('Close')}</button>
      </div>
    </div>
  )
}
