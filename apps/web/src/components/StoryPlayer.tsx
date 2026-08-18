// Curated camera moves (plan §98). A story is a short flight between a few
// named places; the point is that the sculpture reads differently up close,
// and that a viewer who does not know where Lusatia is still gets shown it.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraStory, SculptureMode } from '@datenriff/data-contracts';
import { useAtlasStore } from '../state/store';

interface Props {
  mode: SculptureMode;
}

export function StoryPlayer({ mode }: Props) {
  const playStory = useAtlasStore((s) => s.playStory);
  const activeStop = useAtlasStore((s) => s.storyStop);
  const [playing, setPlaying] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const stop = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPlaying(null);
    playStory(null);
  }, [playStory]);

  useEffect(() => stop, [stop, mode.id]);

  const run = useCallback(
    (story: CameraStory) => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setPlaying(story.id);
      let delay = 0;
      story.stops.forEach((s, i) => {
        timers.current.push(
          setTimeout(() => {
            playStory(s);
            if (i === story.stops.length - 1) {
              timers.current.push(
                setTimeout(() => {
                  setPlaying(null);
                  playStory(null);
                }, s.holdMs ?? 2600),
              );
            }
          }, delay),
        );
        delay += s.holdMs ?? 2600;
      });
    },
    [playStory],
  );

  if (!mode.stories?.length) return null;

  return (
    <div className="stories">
      {mode.stories.map((story) => (
        <button
          key={story.id}
          type="button"
          className={`stories__item${playing === story.id ? ' stories__item--active' : ''}`}
          onClick={() => (playing === story.id ? stop() : run(story))}
        >
          {playing === story.id ? `■ ${activeStop?.label ?? story.label}` : `▶ ${story.label}`}
        </button>
      ))}
    </div>
  );
}
