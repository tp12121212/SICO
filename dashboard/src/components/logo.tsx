import Image from "next/image";

export function Logo() {
  return (
    <div className="relative h-[42px] w-[220px]">
      <Image
        src="/images/logo/purview-workbench-brand-compact.png"
        alt="Purview Workbench"
        fill
        className="object-contain object-left"
        sizes="220px"
        priority
      />
    </div>
  );
}
