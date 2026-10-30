import React from 'react';
import { XLogoIcon } from '../components/SocialIcons';
import { useOnScreen } from './demos';

// "Traders are talking about MarketX" (owner-specified, Oct 2026): real posts about MarketX on X, reproduced word for word as
// clean white post cards (styled on the owner's sample post), with each post's own labels kept as X shows them (verified
// badge, "Automated by"). The founder's post is featured on its own; the community posts glide past in two rows that pause
// under the pointer. Pictures were taken from the owner's screenshots and live in public/landing/x.

interface Post {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  verified?: boolean;
  automatedBy?: string;
  text: string;
  time?: string;
}

const POSTS: Post[] = [
  {
    id: 'dyce',
    name: 'DYÇÊ.XÏ',
    handle: 'DominatorDyce',
    avatar: '/landing/x/dyce.webp',
    verified: true,
    text: 'Have you always wanted to trade or become an actual profitable trader.\n\nEven without knowing any Technical or fundamental analysis?\n\nWell, @_MarketX just opened up it\'s community for traders to be profitable using it\'s system for free',
  },
  {
    id: 'williamz',
    name: 'WILLIAMZ 💫 (🇦🇷)',
    handle: 'Williamz_ThaGr8',
    avatar: '/landing/x/williamz.webp',
    verified: true,
    automatedBy: '0xWilliamz_',
    text: 'Trading without knowing TA or fundamentals. MarketX opened its community free. Join up.',
    time: '7:25 AM · Oct 29, 2026',
  },
  {
    id: 'grace',
    name: 'Sufficient Grace',
    handle: 'Sufficient_G_',
    avatar: '/landing/x/grace.webp',
    verified: true,
    text: 'Traders need this',
    time: '7:23 AM · Oct 29, 2026',
  },
  {
    id: 'willie',
    name: 'WILLIE*WEB3 ⚛',
    handle: 'Willie_web3',
    avatar: '/landing/x/willie.webp',
    text: 'Learning while exploring new tools is the perfect way for beginners to learn.',
    time: '8:26 AM · Oct 29, 2026',
  },
  {
    id: 'pleasure',
    name: 'Pleasure B',
    handle: 'RealPleasureB',
    avatar: '/landing/x/pleasure.webp',
    verified: true,
    text: 'Interesting perspective. More people should be paying attention to developments like this.',
    time: '7:20 AM · Oct 29, 2026',
  },
];

const PROOF_ADDRESS = '5uv2sKFYiQQrSaTfPnA4H3MSVVKuXDrXs53DoSsTMUTs';

/** X's blue verified badge */
const Verified: React.FC = () => (
  <svg viewBox="0 0 22 22" className="w-[17px] h-[17px] shrink-0" aria-label="Verified account" role="img">
    <path
      fill="#1D9BF0"
      d="M20.4 11c0-1.3-.8-2.4-2-3 .4-1.3.2-2.6-.7-3.6s-2.3-1.2-3.6-.7c-.6-1.2-1.7-2-3-2s-2.4.8-3 2c-1.3-.5-2.7-.2-3.6.7s-1.2 2.3-.7 3.6c-1.2.6-2 1.7-2 3s.8 2.4 2 3c-.5 1.3-.2 2.7.7 3.6s2.3 1.2 3.6.7c.6 1.2 1.7 2 3 2s2.4-.8 3-2c1.3.5 2.6.2 3.6-.7s1.2-2.3.7-3.6c1.2-.6 2-1.7 2-3zm-10.6 3.9-3.5-3.5 1.3-1.3 2.2 2.2 4.6-5 1.4 1.3-6 6.3z"
    />
  </svg>
);

/** Post text with @mentions (and the founder's links) in X's blue */
function richText(text: string) {
  const parts = text.split(/(@[A-Za-z0-9_]+|marketx\.world\/checker|[1-9A-HJ-NP-Za-km-z]{43,44})/g);
  return parts.map((p, i) => {
    if (!p) return null;
    if (p === '@_MarketX')
      return (
        <a key={i} href="https://x.com/_MarketX" target="_blank" rel="noopener noreferrer" className="text-[#1D9BF0] hover:underline">
          {p}
        </a>
      );
    if (p.startsWith('@')) return <span key={i} className="text-[#1D9BF0]">{p}</span>;
    if (p === 'marketx.world/checker')
      return (
        <a key={i} href="/checker" className="text-[#1D9BF0] hover:underline">
          {p}
        </a>
      );
    if (p === PROOF_ADDRESS)
      return (
        <a key={i} href={`https://solscan.io/account/${p}`} target="_blank" rel="noopener noreferrer" className="text-[#1D9BF0] hover:underline break-all">
          {p}
        </a>
      );
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

const PostCard: React.FC<{ post: Post; className?: string; children?: React.ReactNode; tag?: string; hidden?: boolean }> = ({ post, className = '', children, tag, hidden }) => (
  <article className={`lx-post ${className}`} aria-hidden={hidden || undefined}>
    <header className="flex items-start gap-3">
      <img src={post.avatar} alt="" width={44} height={44} loading="lazy" className="w-11 h-11 rounded-full object-cover bg-[#e7e7ee] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 min-w-0">
          <span className="font-bold text-[15px] text-[#0f1419] truncate">{post.name}</span>
          {post.verified && <Verified />}
          {tag && <span className="ml-1 shrink-0 text-[10.5px] font-semibold text-white bg-[#0f1419] rounded-full px-2 py-0.5">{tag}</span>}
        </p>
        <p className="text-[14px] text-[#536471] truncate">@{post.handle}</p>
      </div>
      <XLogoIcon className="w-5 h-5 text-[#0f1419] shrink-0 mt-0.5" />
    </header>
    {post.automatedBy && (
      <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-[#536471]">
        <span aria-hidden="true">🤖</span> Automated by <span className="text-[#1D9BF0]">@{post.automatedBy}</span>
      </p>
    )}
    <p className="mt-3 text-[15px] leading-[1.45] text-[#0f1419] whitespace-pre-line break-words">{richText(post.text)}</p>
    {children}
    {post.time && <p className="mt-3 text-[13.5px] text-[#536471]">{post.time}</p>}
  </article>
);

const FOUNDER: Post = {
  id: 'saamie',
  name: 'Alive',
  handle: '_saamie',
  avatar: '/landing/x/saamie.webp',
  text: `Y'all asking for proves, here you go.\ncheck out this address on @solana to verify this results yourself.\n\n${PROOF_ADDRESS}\n\nclick on each transactions to read their memo and see proves.\n\nwant to see it compiled, visit: marketx.world/checker`,
};

// Each row holds every post (different order), shown twice back to back so the glide loops without a seam
const ROW_A = [POSTS[0], POSTS[1], POSTS[2], POSTS[3], POSTS[4]];
const ROW_B = [POSTS[4], POSTS[3], POSTS[0], POSTS[2], POSTS[1]];

const Row: React.FC<{ posts: Post[]; reverse?: boolean }> = ({ posts, reverse }) => (
  <div className={`lx-slide-row ${reverse ? 'reverse' : ''}`}>
    {[...posts, ...posts].map((p, i) => (
      <PostCard key={`${p.id}-${i}`} post={p} hidden={i >= posts.length} className="w-[300px] sm:w-[340px] shrink-0" />
    ))}
  </div>
);

export const XPosts: React.FC = () => {
  const [ref, on] = useOnScreen<HTMLElement>('200px');
  return (
    <section ref={ref} className={`lx-xposts px-0 py-24 ${on ? 'run' : ''}`} aria-labelledby="lx-xposts-title">
      <div className="px-5 text-center">
        <p data-reveal className="inline-flex items-center gap-2 text-[11px] text-[#9b9cab]">
          <XLogoIcon className="w-3 h-3" /> On X
        </p>
        <h2 id="lx-xposts-title" data-reveal="2" className="mt-2 text-[26px] sm:text-[36px] font-bold tracking-[-0.03em]">
          Traders are talking about <span className="lx-grad-text">MarketX</span>
        </h2>
      </div>

      {/* The founder's post, featured */}
      <div data-reveal="3" className="mt-12 px-5">
        <PostCard post={FOUNDER} tag="Founder" className="lx-post-featured max-w-[560px] mx-auto">
          <div className="mt-3 rounded-2xl overflow-hidden border border-[#cfd9de] bg-black">
            <img src="/landing/x/memo.webp" alt="A MarketX signal result written on Solana, as shown on Solscan" width={566} height={116} loading="lazy" className="w-full h-auto block" />
          </div>
        </PostCard>
      </div>

      {/* Community posts glide past in two rows */}
      <div className="lx-slide mt-10 space-y-4" data-reveal="4">
        <Row posts={ROW_A} />
        <Row posts={ROW_B} reverse />
      </div>
    </section>
  );
};
