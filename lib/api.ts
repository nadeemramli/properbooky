import { supabase } from "@/lib/supabase";
import type { Tag } from "@/types/book";

// Tag Management
export async function createTag(name: string, color: string = '#94A3B8') {
  const { data, error } = await supabase
    .from('tags')
    .insert([{ name, color }])
    .select()
    .single();

  if (error) throw error;
  return data as Tag;
}

export async function updateTag(id: string, updates: { name?: string; color?: string }) {
  const { data, error } = await supabase
    .from('tags')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data as Tag;
}

export async function deleteTag(id: string) {
  const { error } = await supabase
    .from('tags')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function getTags() {
  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .order('name');

  if (error) throw error;
  return data as Tag[];
}

// Book Tag Management
export async function addTagToBook(bookId: string, tagId: string) {
  const { error } = await supabase
    .from('book_tags')
    .insert([{ book_id: bookId, tag_id: tagId }]);

  if (error) throw error;
}

export async function removeTagFromBook(bookId: string, tagId: string) {
  const { error } = await supabase
    .from('book_tags')
    .delete()
    .eq('book_id', bookId)
    .eq('tag_id', tagId);

  if (error) throw error;
}

interface BookTagJoin {
  tags: {
    id: string;
    name: string;
    user_id: string;
    color: string;
    created_at: string;
    updated_at: string;
  };
}

export async function getBookTags(bookId: string): Promise<Tag[]> {
  const { data, error } = await supabase
    .from('book_tags')
    .select(`
      tags:tag_id (
        id,
        name,
        user_id,
        color,
        created_at,
        updated_at
      )
    `)
    .eq('book_id', bookId) as { data: BookTagJoin[] | null; error: any };

  if (error) throw error;
  return (data?.map(item => item.tags) || []) as Tag[];
} 